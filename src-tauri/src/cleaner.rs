use crate::ctx::{ctx, is_admin};
use crate::fsx::{dir_size, empty_dir};
use crate::model::{ItemResult, Res, Risk, ScanItem};
use crate::safety::is_protected_path;
use crate::util::format_bytes;
use regex::Regex;
use serde_json::json;
use std::mem::{size_of, zeroed};
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::Mutex;
use windows_sys::Win32::UI::Shell::{SHEmptyRecycleBinW, SHQueryRecycleBinW, SHQUERYRBINFO};

pub struct Profiles {
    pub root: PathBuf,
    pub pattern: &'static str,
    pub sub: Vec<PathBuf>,
}

pub struct CleanTarget {
    pub id: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
    pub group: &'static str,
    pub risk: Risk,
    pub needs_admin: bool,
    pub dirs: Vec<PathBuf>,
    pub files: Vec<PathBuf>,
    pub profiles: Option<Profiles>,
    pub recycle_bin: bool,
}

#[derive(Clone, Default)]
pub struct Env {
    pub temp: String,
    pub local: String,
    pub system_root: String,
    pub program_data: String,
}

impl Env {
    pub fn from_process() -> Env {
        let get = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        Env {
            temp: get("TEMP", ""),
            local: get("LOCALAPPDATA", ""),
            system_root: get("SystemRoot", r"C:\Windows"),
            program_data: get("ProgramData", r"C:\ProgramData"),
        }
    }
}

fn t(id: &'static str, label: &'static str, detail: &'static str, group: &'static str, risk: Risk) -> CleanTarget {
    CleanTarget { id, label, detail, group, risk, needs_admin: false, dirs: vec![], files: vec![], profiles: None, recycle_bin: false }
}

pub fn resolve_targets(env: &Env) -> Vec<CleanTarget> {
    let local = PathBuf::from(&env.local);
    let win = PathBuf::from(&env.system_root);
    let pd = PathBuf::from(&env.program_data);
    let chromium = |id: &'static str, label: &'static str, root: PathBuf| CleanTarget {
        profiles: Some(Profiles {
            root,
            pattern: r"^(Default|Profile \d+)$",
            sub: vec![
                PathBuf::from("Cache"),
                PathBuf::from("Code Cache"),
                PathBuf::from("GPUCache"),
                PathBuf::from("Service Worker").join("CacheStorage"),
            ],
        }),
        ..t(id, label, "Cache, code cache and GPU cache. Logins and bookmarks are kept.", "Browsers", Risk::Safe)
    };
    vec![
        CleanTarget { dirs: vec![PathBuf::from(&env.temp)], ..t("user-temp", "User temporary files", "Leftover files from apps and installers", "Windows", Risk::Safe) },
        CleanTarget { needs_admin: true, dirs: vec![win.join("Temp")], ..t("win-temp", "Windows temporary files", "System-wide temp folder", "Windows", Risk::Safe) },
        CleanTarget { needs_admin: true, dirs: vec![win.join("Prefetch")], ..t("prefetch", "Prefetch cache", "Windows rebuilds this automatically", "Windows", Risk::Low) },
        CleanTarget { needs_admin: true, dirs: vec![win.join("SoftwareDistribution").join("Download")], ..t("wu-cache", "Windows Update download cache", "Already-installed update packages", "Windows", Risk::Low) },
        CleanTarget { dirs: vec![local.join("Microsoft").join("Windows").join("Explorer")], ..t("thumbnails", "Thumbnail and icon cache", "Explorer regenerates thumbnails when needed", "Windows", Risk::Safe) },
        CleanTarget {
            dirs: vec![local.join("CrashDumps"), win.join("Minidump")],
            files: vec![win.join("MEMORY.DMP")],
            ..t("crash-dumps", "Crash dumps and memory dumps", "Debug dumps from app and system crashes", "Windows", Risk::Safe)
        },
        CleanTarget { needs_admin: true, dirs: vec![win.join("Logs").join("CBS")], ..t("win-logs", "Windows log files", "Servicing (CBS) logs", "Windows", Risk::Safe) },
        CleanTarget { needs_admin: true, dirs: vec![pd.join("Microsoft").join("Windows").join("WER")], ..t("wer", "Windows Error Reporting", "Queued crash reports", "Windows", Risk::Safe) },
        CleanTarget { dirs: vec![local.join("Microsoft").join("Windows").join("INetCache")], ..t("inet-cache", "Internet cache (Windows)", "Cached web content used by Windows apps", "Windows", Risk::Safe) },
        CleanTarget { dirs: vec![local.join("D3DSCache")], ..t("shader-cache", "DirectX shader cache", "Rebuilt by games the next time they run", "Apps", Risk::Low) },
        CleanTarget { recycle_bin: true, ..t("recycle-bin", "Recycle Bin", "Files you already deleted", "System", Risk::Low) },
        chromium("chrome", "Google Chrome cache", local.join("Google").join("Chrome").join("User Data")),
        chromium("edge", "Microsoft Edge cache", local.join("Microsoft").join("Edge").join("User Data")),
        chromium("brave", "Brave cache", local.join("BraveSoftware").join("Brave-Browser").join("User Data")),
        CleanTarget {
            profiles: Some(Profiles { root: local.join("Mozilla").join("Firefox").join("Profiles"), pattern: r".+", sub: vec![PathBuf::from("cache2")] }),
            ..t("firefox", "Mozilla Firefox cache", "Cached web content. Logins and bookmarks are kept.", "Browsers", Risk::Safe)
        },
    ]
}

fn targets() -> Vec<CleanTarget> {
    resolve_targets(&Env::from_process())
}

fn expand_dirs(t: &CleanTarget) -> Vec<PathBuf> {
    let mut dirs = t.dirs.clone();
    if let Some(p) = &t.profiles {
        if let (Ok(re), Ok(rd)) = (Regex::new(p.pattern), std::fs::read_dir(&p.root)) {
            for e in rd.filter_map(|e| e.ok()) {
                if re.is_match(&e.file_name().to_string_lossy()) {
                    for s in &p.sub {
                        dirs.push(e.path().join(s));
                    }
                }
            }
        }
    }
    dirs.into_iter().filter(|d| !d.as_os_str().is_empty() && d.exists()).collect()
}

fn recycle_size() -> u64 {
    unsafe {
        let mut info: SHQUERYRBINFO = zeroed();
        info.cbSize = size_of::<SHQUERYRBINFO>() as u32;
        if SHQueryRecycleBinW(null(), &mut info) == 0 { info.i64Size.max(0) as u64 } else { 0 }
    }
}

fn recycle_empty() -> bool {
    unsafe { SHEmptyRecycleBinW(null_mut(), null(), 7) >= 0 }
}

fn target_size(t: &CleanTarget) -> u64 {
    if t.recycle_bin {
        return recycle_size();
    }
    let dirs: u64 = expand_dirs(t).iter().map(|d| dir_size(d)).sum();
    let files: u64 = t.files.iter().filter_map(|f| std::fs::metadata(f).ok()).map(|m| m.len()).sum();
    dirs + files
}

pub fn scan_items() -> Vec<ScanItem> {
    let admin = is_admin();
    let out: Mutex<Vec<ScanItem>> = Mutex::new(vec![]);
    let all = targets();
    std::thread::scope(|s| {
        for t in &all {
            let out = &out;
            s.spawn(move || {
                let size = target_size(t);
                if size == 0 {
                    return;
                }
                let item = ScanItem::new(t.id, t.label, t.risk)
                    .detail(t.detail)
                    .size(size)
                    .admin(t.needs_admin && !admin)
                    .meta(json!({ "group": t.group }));
                out.lock().unwrap_or_else(|e| e.into_inner()).push(item);
            });
        }
    });
    let mut items = out.into_inner().unwrap_or_default();
    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    items
}

pub fn apply_ids(ids: &[String], source: &str) -> Vec<ItemResult> {
    let admin = is_admin();
    let all = targets();
    let mut results = vec![];
    let mut total = 0u64;
    for id in ids {
        let Some(t) = all.iter().find(|x| x.id == id) else {
            results.push(ItemResult::failed(id, "Unknown target"));
            continue;
        };
        if t.needs_admin && !admin {
            results.push(ItemResult::skipped(id, "Needs administrator rights"));
            continue;
        }
        let (mut freed, mut failed) = (0u64, 0u32);
        if t.recycle_bin {
            let before = recycle_size();
            if recycle_empty() { freed = before } else { failed += 1 }
        } else {
            for d in expand_dirs(t) {
                let r = empty_dir(&d, &is_protected_path);
                freed += r.freed;
                failed += r.failed;
            }
            for f in &t.files {
                if is_protected_path(&f.to_string_lossy()) {
                    continue;
                }
                if let Ok(m) = std::fs::metadata(f) {
                    if std::fs::remove_file(f).is_ok() {
                        freed += m.len();
                    }
                }
            }
        }
        total += freed;
        let mut r = ItemResult::ok(id).freed(freed);
        if failed > 0 {
            r.reason = Some(format!("{failed} item(s) in use were skipped"));
        }
        results.push(r);
    }
    ctx().record_freed(total, source);
    if total > 0 {
        ctx().log_add("cleaner", &format!("{source}: freed {}", format_bytes(total)), "none", None);
    }
    results
}

pub fn details(id: &str) -> Res<serde_json::Value> {
    let all = targets();
    let t = all.iter().find(|x| x.id == id).ok_or("Unknown target")?;
    if t.recycle_bin {
        return Ok(json!({ "items": [], "total": 0, "note": "Windows does not list what is in the Recycle Bin here." }));
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(6);
    let mut rows: Vec<(String, String, u64, bool)> = vec![];
    for d in expand_dirs(t) {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let path = e.path();
            let is_dir = std::fs::symlink_metadata(&path).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false);
            let size = crate::fsx::dir_size_until(&path, Some(deadline));
            rows.push((e.file_name().to_string_lossy().into_owned(), path.to_string_lossy().into_owned(), size, is_dir));
        }
    }
    for f in &t.files {
        if let Ok(m) = std::fs::metadata(f) {
            rows.push((f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), f.to_string_lossy().into_owned(), m.len(), false));
        }
    }
    rows.retain(|r| !is_protected_path(&r.1));
    rows.sort_by(|a, b| b.2.cmp(&a.2));
    let total = rows.len();
    let items: Vec<_> = rows.into_iter().take(40).map(|(name, path, size, is_dir)| json!({ "name": name, "path": path, "size": size, "isDir": is_dir })).collect();
    Ok(json!({ "items": items, "total": total }))
}

pub fn scan() -> Res<serde_json::Value> {
    crate::model::to_value(scan_items())
}

pub fn apply(ids: Vec<String>) -> Res<serde_json::Value> {
    crate::model::to_value(apply_ids(&ids, "Junk Cleaner"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> Env {
        Env {
            temp: r"C:\Users\bob\AppData\Local\Temp".into(),
            local: r"C:\Users\bob\AppData\Local".into(),
            system_root: r"C:\Windows".into(),
            program_data: r"C:\ProgramData".into(),
        }
    }

    #[test]
    fn ids_are_unique_and_core_targets_exist() {
        let ts = resolve_targets(&env());
        let mut ids: Vec<_> = ts.iter().map(|t| t.id).collect();
        for id in ["user-temp", "win-temp", "prefetch", "wu-cache", "thumbnails", "recycle-bin", "chrome", "edge", "firefox", "brave"] {
            assert!(ids.contains(&id), "{id}");
        }
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n);
    }

    #[test]
    fn paths_come_from_the_environment() {
        let ts = resolve_targets(&env());
        let ut = ts.iter().find(|t| t.id == "user-temp").unwrap();
        assert_eq!(ut.dirs[0], PathBuf::from(r"C:\Users\bob\AppData\Local\Temp"));
        let wt = ts.iter().find(|t| t.id == "win-temp").unwrap();
        assert_eq!(wt.dirs[0], PathBuf::from(r"C:\Windows").join("Temp"));
    }

    #[test]
    fn no_target_directory_is_protected() {
        for t in resolve_targets(&env()) {
            for d in &t.dirs {
                assert!(!is_protected_path(&d.join("x.tmp").to_string_lossy()), "{}: {}", t.id, d.display());
            }
            for f in &t.files {
                assert!(!is_protected_path(&f.to_string_lossy()), "{}: {}", t.id, f.display());
            }
        }
    }
}
