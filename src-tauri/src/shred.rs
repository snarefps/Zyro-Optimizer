use crate::ctx::ctx;
use crate::model::Res;
use crate::safety::is_system_path;
use crate::util::now_ms;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

const CHUNK: usize = 1 << 20;

fn check(path: &str) -> Result<u64, String> {
    let p = Path::new(path);
    let md = std::fs::symlink_metadata(p).map_err(|_| "File not found".to_string())?;
    if md.file_type().is_symlink() || !md.is_file() {
        return Err("Only regular files can be shredded".into());
    }
    if is_system_path(path) {
        return Err("Protected location".into());
    }
    Ok(md.len())
}

pub fn inspect(path: String) -> Res<Value> {
    let path = path.trim().trim_matches('"').to_string();
    Ok(match check(&path) {
        Ok(size) => json!({ "ok": true, "path": path, "size": size }),
        Err(reason) => json!({ "ok": false, "path": path, "reason": reason }),
    })
}

fn next(state: &mut u64) -> u8 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    (*state >> 24) as u8
}

fn overwrite(path: &Path, size: u64) -> std::io::Result<()> {
    let mut perms = std::fs::metadata(path)?.permissions();
    if perms.readonly() {
        perms.set_readonly(false);
        std::fs::set_permissions(path, perms)?;
    }
    let mut f = OpenOptions::new().write(true).open(path)?;
    let mut seed = now_ms() | 1;
    for pass in 0..3 {
        f.seek(SeekFrom::Start(0))?;
        let mut left = size;
        while left > 0 {
            let n = left.min(CHUNK as u64) as usize;
            let buf: Vec<u8> = match pass {
                0 => vec![0x00; n],
                1 => vec![0xFF; n],
                _ => (0..n).map(|_| next(&mut seed)).collect(),
            };
            f.write_all(&buf)?;
            left -= n as u64;
        }
        f.sync_all()?;
    }
    f.set_len(0)?;
    f.sync_all()
}

fn shred_one(path: &str) -> Result<(), String> {
    let size = check(path)?;
    let p = Path::new(path);
    overwrite(p, size).map_err(|e| format!("Could not overwrite it: {e}"))?;
    let hidden = p.with_file_name(format!("{:x}", now_ms() ^ size));
    let target = if std::fs::rename(p, &hidden).is_ok() { hidden } else { p.to_path_buf() };
    std::fs::remove_file(target).map_err(|e| e.to_string())
}

pub fn run(paths: Vec<String>) -> Res<Value> {
    let mut out = vec![];
    let mut done = 0;
    for p in paths {
        if crate::jobs::requested() {
            out.push(json!({ "path": p, "ok": false, "reason": "Cancelled" }));
            continue;
        }
        match shred_one(&p) {
            Ok(()) => {
                done += 1;
                out.push(json!({ "path": p, "ok": true }));
            }
            Err(reason) => out.push(json!({ "path": p, "ok": false, "reason": reason })),
        }
    }
    if done > 0 {
        ctx().log_add("shred", &format!("Shredded {done} file(s)"), "none", None);
    }
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shred_file() {
        let dir = std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap()).join(format!("zyro-shred-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("secret.txt");
        std::fs::write(&file, vec![7u8; 3_000_000]).unwrap();
        assert_eq!(check(&file.to_string_lossy()).unwrap(), 3_000_000);
        assert!(check(&dir.to_string_lossy()).is_err());
        shred_one(&file.to_string_lossy()).unwrap();
        assert!(!file.exists());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn system_files_are_refused() {
        assert!(check(r"C:\Windows\System32\kernel32.dll").is_err());
    }
}
