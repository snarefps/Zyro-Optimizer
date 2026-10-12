use crate::ctx::{ctx, emit};
use crate::duplicates::find_duplicates;
use crate::fsx::dir_size_until;
use crate::model::{to_value, Res};
use crate::monitor::disk_space;
use crate::safety::is_system_path;
use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use walkdir::WalkDir;
use windows_sys::Win32::Storage::FileSystem::GetLogicalDrives;

const SKIP_DIRS: &[&str] = &["windows", "$recycle.bin", "system volume information", "node_modules", ".git", "windowsapps", "winsxs"];

pub fn drives() -> Res<Value> {
    let mask = unsafe { GetLogicalDrives() };
    let mut out = vec![];
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        if let Some((total, free)) = disk_space(&format!("{letter}:\\")) {
            if total > 0 {
                out.push(json!({ "letter": letter.to_string(), "total": total, "free": free }));
            }
        }
    }
    Ok(Value::Array(out))
}

fn resolve_root(p: &str) -> String {
    if p == "~" {
        std::env::var("USERPROFILE").unwrap_or_else(|_| r"C:\Users".into())
    } else {
        p.to_string()
    }
}

pub fn analyze(path: String) -> Res<Value> {
    let path = resolve_root(&path);
    let deadline = Instant::now() + Duration::from_secs(25);
    let entries: Vec<(String, PathBuf, bool)> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let ft = e.file_type().ok()?;
            if ft.is_symlink() {
                return None;
            }
            Some((e.file_name().to_string_lossy().to_string(), e.path(), ft.is_dir()))
        })
        .collect();
    let idx = AtomicUsize::new(0);
    let children: Mutex<Vec<Value>> = Mutex::new(vec![]);
    std::thread::scope(|s| {
        for _ in 0..6 {
            s.spawn(|| loop {
                let i = idx.fetch_add(1, Ordering::Relaxed);
                let Some((name, full, is_dir)) = entries.get(i) else { break };
                let size = if *is_dir { dir_size_until(full, Some(deadline)) } else { std::fs::symlink_metadata(full).map(|m| m.len()).unwrap_or(0) };
                if size > 0 {
                    children.lock().unwrap_or_else(|e| e.into_inner()).push(json!({ "name": name, "path": full.to_string_lossy(), "size": size, "isDir": is_dir }));
                }
            });
        }
    });
    let mut children = children.into_inner().unwrap_or_default();
    children.sort_by(|a, b| b["size"].as_u64().cmp(&a["size"].as_u64()));
    let total: u64 = children.iter().filter_map(|c| c["size"].as_u64()).sum();
    Ok(json!({ "path": path, "total": total, "partial": Instant::now() > deadline, "children": children }))
}

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel() -> Res<Value> {
    CANCEL.store(true, Ordering::Relaxed);
    Ok(Value::Null)
}

fn walk(root: &str, mut visit: impl FnMut(PathBuf, u64)) {
    CANCEL.store(false, Ordering::Relaxed);
    let mut seen = 0usize;
    let it = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        e.depth() == 0 || !e.file_type().is_dir() || !SKIP_DIRS.contains(&e.file_name().to_string_lossy().to_lowercase().as_str())
    });
    for e in it.filter_map(|e| e.ok()) {
        if CANCEL.load(Ordering::Relaxed) {
            break;
        }
        if e.file_type().is_file() {
            if let Ok(m) = e.metadata() {
                visit(e.path().to_path_buf(), m.len());
            }
            seen += 1;
            if seen % 2000 == 0 {
                emit("disk:progress", json!({ "scanned": seen, "current": e.path().parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default() }));
            }
        }
    }
}

pub fn large_files(root: String, min_mb: u64, limit: usize) -> Res<Value> {
    let root = resolve_root(&root);
    let min = min_mb * 1_048_576;
    let mut found: Vec<(PathBuf, u64)> = vec![];
    walk(&root, |p, s| {
        if s >= min {
            found.push((p, s));
        }
    });
    found.sort_by(|a, b| b.1.cmp(&a.1));
    found.truncate(limit);
    to_value(found.into_iter().map(|(p, s)| json!({ "path": p.to_string_lossy(), "size": s })).collect::<Vec<_>>())
}

pub fn duplicates(root: String, min_mb: u64) -> Res<Value> {
    let root = resolve_root(&root);
    let min = min_mb * 1_048_576;
    let mut files: Vec<(PathBuf, u64)> = vec![];
    walk(&root, |p, s| {
        if s >= min {
            files.push((p, s));
        }
    });
    emit("disk:progress", json!({ "scanned": files.len(), "current": "Comparing files..." }));
    let groups = find_duplicates(&files, &|done, total| {
        if done % 25 == 0 {
            emit("disk:progress", json!({ "scanned": done, "current": format!("Comparing {done}/{total}") }));
        }
    });
    to_value(groups)
}

pub fn trash(paths: Vec<String>) -> Res<Value> {
    let mut out = vec![];
    let mut moved = 0;
    for p in paths {
        if is_system_path(&p) {
            out.push(json!({ "path": p, "ok": false, "reason": "Protected location" }));
            continue;
        }
        match trash::delete(&p) {
            Ok(_) => {
                moved += 1;
                out.push(json!({ "path": p, "ok": true }));
            }
            Err(e) => out.push(json!({ "path": p, "ok": false, "reason": e.to_string() })),
        }
    }
    if moved > 0 {
        ctx().log_add("disk", &format!("Moved {moved} file(s) to the Recycle Bin (restore them from there)"), "none", None);
    }
    Ok(Value::Array(out))
}

pub fn reveal(path: String) -> Res<Value> {
    let p = Path::new(&path);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let _ = Command::new("explorer.exe").raw_arg(format!("/select,\"{path}\"")).spawn();
    Ok(json!(name))
}
