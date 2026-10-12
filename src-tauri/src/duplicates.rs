use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

const HEAD_BYTES: usize = 64 * 1024;

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct DupGroup {
    pub size: u64,
    pub hash: String,
    pub files: Vec<String>,
}

fn head_hash(path: &PathBuf) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; HEAD_BYTES];
    let n = f.read(&mut buf)?;
    Ok(hex(&Sha256::digest(&buf[..n])))
}

fn full_hash(path: &PathBuf) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn find_duplicates(files: &[(PathBuf, u64)], progress: &dyn Fn(usize, usize)) -> Vec<DupGroup> {
    let mut by_size: HashMap<u64, Vec<&PathBuf>> = HashMap::new();
    for (p, s) in files {
        by_size.entry(*s).or_default().push(p);
    }
    let groups: Vec<(u64, Vec<&PathBuf>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
    let total: usize = groups.iter().map(|(_, v)| v.len()).sum();
    let mut done = 0;
    let mut result = vec![];
    for (size, group) in groups {
        let mut heads: HashMap<String, Vec<&PathBuf>> = HashMap::new();
        for p in group {
            if let Ok(h) = head_hash(p) {
                heads.entry(h).or_default().push(p);
            }
            done += 1;
            progress(done, total);
        }
        for same_head in heads.into_values().filter(|v| v.len() > 1) {
            let mut fulls: HashMap<String, Vec<String>> = HashMap::new();
            for p in same_head {
                if let Ok(h) = full_hash(p) {
                    fulls.entry(h).or_default().push(p.to_string_lossy().to_string());
                }
            }
            for (hash, mut paths) in fulls.into_iter().filter(|(_, v)| v.len() > 1) {
                paths.sort();
                result.push(DupGroup { size, hash, files: paths });
            }
        }
    }
    result.sort_by(|a, b| (b.size * b.files.len() as u64).cmp(&(a.size * a.files.len() as u64)));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (PathBuf, Vec<(PathBuf, u64)>) {
        // parallel tests, so each one needs its own folder name
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("zyro-dup-{}-{}-{n}", std::process::id(), crate::util::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let mut files = vec![];
        let mut mk = |name: &str, content: Vec<u8>| {
            let p = dir.join(name);
            fs::write(&p, &content).unwrap();
            files.push((p, content.len() as u64));
        };
        let a = vec![b'a'; 200_000];
        let b = vec![b'b'; 200_000]; // same size as a, different content
        let mut c = vec![b'c'; 100_000];
        c.push(b'x'); // unique size
        let mut tail = vec![b'a'; 199_999]; // same size and same first 64 KB as a, differs only at the end
        tail.push(b'Z');
        mk("a1.bin", a.clone());
        mk("a2.bin", a);
        mk("b1.bin", b);
        mk("c1.bin", c);
        mk("tail.bin", tail);
        (dir, files)
    }

    #[test]
    fn groups_only_byte_identical_files() {
        let (dir, files) = setup();
        let groups = find_duplicates(&files, &|_, _| {});
        assert_eq!(groups.len(), 1);
        let names: Vec<_> = groups[0].files.iter().map(|f| PathBuf::from(f).file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["a1.bin", "a2.bin"]);
        assert_eq!(groups[0].size, 200_000);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn returns_nothing_without_duplicates() {
        let (dir, files) = setup();
        let without: Vec<_> = files.into_iter().filter(|(p, _)| !p.to_string_lossy().contains("a2")).collect();
        assert!(find_duplicates(&without, &|_, _| {}).is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
