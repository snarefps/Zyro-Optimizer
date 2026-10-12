use std::fs;
use std::path::Path;
use std::time::Instant;
use walkdir::WalkDir;

pub fn dir_size_until(p: &Path, deadline: Option<Instant>) -> u64 {
    let Ok(md) = fs::symlink_metadata(p) else { return 0 };
    if md.file_type().is_symlink() {
        return 0;
    }
    if md.is_file() {
        return md.len();
    }
    let mut total = 0u64;
    for (i, entry) in WalkDir::new(p).follow_links(false).into_iter().filter_map(|e| e.ok()).enumerate() {
        if i % 512 == 0 {
            if let Some(d) = deadline {
                if Instant::now() > d {
                    break;
                }
            }
        }
        if entry.file_type().is_file() {
            if let Ok(m) = entry.metadata() {
                total += m.len();
            }
        }
    }
    total
}

pub fn dir_size(p: &Path) -> u64 {
    dir_size_until(p, None)
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct EmptyResult {
    pub freed: u64,
    pub failed: u32,
    pub skipped: u32,
}

pub fn empty_dir(dir: &Path, is_protected: &dyn Fn(&str) -> bool) -> EmptyResult {
    let mut res = EmptyResult::default();
    let Ok(rd) = fs::read_dir(dir) else { return res };
    for entry in rd.filter_map(|e| e.ok()) {
        let path = entry.path();
        if is_protected(&path.to_string_lossy()) {
            res.skipped += 1;
            continue;
        }
        let before = dir_size(&path);
        let is_real_dir = fs::symlink_metadata(&path).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false);
        let removed = if is_real_dir { fs::remove_dir_all(&path) } else { fs::remove_file(&path).or_else(|_| fs::remove_dir(&path)) };
        if removed.is_err() {
            res.failed += 1;
        }
        let after = if path.exists() { dir_size(&path) } else { 0 };
        if after > 0 && removed.is_ok() {
            res.failed += 1;
        }
        res.freed += before.saturating_sub(after);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn make_tree(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("zyro-{name}-{}", crate::util::now_ms()));
        fs::create_dir_all(root.join("a").join("b")).unwrap();
        fs::write(root.join("x.tmp"), vec![0u8; 1000]).unwrap();
        fs::write(root.join("a").join("y.tmp"), vec![0u8; 2000]).unwrap();
        fs::write(root.join("a").join("b").join("z.tmp"), vec![0u8; 3000]).unwrap();
        fs::write(root.join("keep.dat"), vec![0u8; 500]).unwrap();
        root
    }

    #[test]
    fn measures_and_empties_keeping_the_folder() {
        let root = make_tree("empty");
        assert_eq!(dir_size(&root), 6500);
        let r = empty_dir(&root, &|_| false);
        assert_eq!(r.freed, 6500);
        assert_eq!(r.failed, 0);
        assert!(root.exists());
        assert_eq!(dir_size(&root), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn never_deletes_what_the_guard_protects() {
        let root = make_tree("guard");
        let r = empty_dir(&root, &|p| p.ends_with("keep.dat"));
        assert_eq!(r.skipped, 1);
        assert_eq!(r.freed, 6000);
        assert!(root.join("keep.dat").exists());
        assert!(!root.join("a").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_folder_is_a_no_op() {
        let r = empty_dir(&std::env::temp_dir().join("zyro-does-not-exist-xyz"), &|_| false);
        assert_eq!(r, EmptyResult::default());
    }

    #[test]
    fn real_blocklist_protects_documents() {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| r"C:\Users\x".into());
        assert!(crate::safety::is_protected_path(&format!(r"{home}\Documents\thesis.docx")));
    }
}
