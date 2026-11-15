use crate::ctx::{ctx, is_admin};
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::safety::is_system_path;
use crate::util::{run_ps_json, str_field};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static OFFERED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

const LINKS: &str = r#"
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))
$sh = New-Object -ComObject WScript.Shell
foreach ($d in $dirs) {
  if ($d -and (Test-Path -LiteralPath $d)) {
    Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      $t = $sh.CreateShortcut($_.FullName).TargetPath
      if ($t -match '^[A-Za-z]:\\' -and -not (Test-Path -LiteralPath $t) -and (Test-Path -LiteralPath $t.Substring(0, 3))) {
        [pscustomobject]@{ path = $_.FullName; target = $t }
      }
    }
  }
}
"#;

fn roots() -> Vec<PathBuf> {
    let profile = PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default());
    ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"].iter().map(|d| profile.join(d)).filter(|p| p.is_dir()).collect()
}

fn walk(dir: &Path, deadline: Instant) -> (bool, Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return (false, vec![]) };
    let mut empty = true;
    let mut reported = vec![];
    for e in rd.filter_map(|e| e.ok()) {
        let path = e.path();
        let is_dir = std::fs::symlink_metadata(&path).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false);
        if !is_dir || Instant::now() > deadline {
            empty = false;
            continue;
        }
        let (child_empty, inner) = walk(&path, deadline);
        if child_empty {
            reported.push(path);
        } else {
            empty = false;
            reported.extend(inner);
        }
    }
    (empty, reported)
}

fn is_empty_tree(dir: &Path) -> bool {
    walk(dir, Instant::now() + Duration::from_secs(10)).0
}

pub fn scan() -> Res<Value> {
    let admin = is_admin();
    let deadline = Instant::now() + Duration::from_secs(25);
    let mut items = vec![];
    for root in roots() {
        for dir in walk(&root, deadline).1.into_iter().take(300) {
            let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            items.push(
                ScanItem::new(format!("dir|{}", dir.to_string_lossy()), name, Risk::Low)
                    .detail(dir.to_string_lossy().to_string())
                    .meta(json!({ "group": "Empty folders" })),
            );
        }
    }
    for l in run_ps_json(LINKS, Duration::from_secs(60)).unwrap_or_default() {
        let path = str_field(&l, "path");
        let stem = Path::new(&path).file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let shared = path.to_lowercase().contains("programdata") || path.to_lowercase().contains(r"\users\public\");
        items.push(
            ScanItem::new(format!("lnk|{path}"), stem, Risk::Safe)
                .detail(format!("Points to {}, which is gone", str_field(&l, "target")))
                .admin(shared && !admin)
                .meta(json!({ "group": "Broken shortcuts" })),
        );
    }
    *OFFERED.lock().unwrap_or_else(|e| e.into_inner()) = Some(items.iter().map(|i| i.id.to_lowercase()).collect());
    to_value(items)
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let offered = OFFERED.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
    let mut out = vec![];
    let (mut folders, mut links) = (0, 0);
    for id in ids {
        if crate::jobs::requested() {
            out.push(ItemResult::skipped(&id, "Cancelled"));
            continue;
        }
        if !offered.contains(&id.to_lowercase()) {
            out.push(ItemResult::skipped(&id, "Not found by the last scan"));
            continue;
        }
        let (kind, path) = id.split_once('|').unwrap_or(("", ""));
        if is_system_path(path) {
            out.push(ItemResult::skipped(&id, "Protected location"));
            continue;
        }
        out.push(match kind {
            "dir" => {
                if !is_empty_tree(Path::new(path)) {
                    ItemResult::skipped(&id, "Something was added to this folder")
                } else {
                    match std::fs::remove_dir_all(path) {
                        Ok(()) => {
                            folders += 1;
                            ItemResult::ok(&id)
                        }
                        Err(e) => ItemResult::failed(&id, e.to_string()),
                    }
                }
            }
            "lnk" => match trash::delete(path) {
                Ok(()) => {
                    links += 1;
                    ItemResult::ok(&id)
                }
                Err(e) => ItemResult::failed(&id, e.to_string()),
            },
            _ => ItemResult::failed(&id, "Unknown item"),
        });
    }
    if folders + links > 0 {
        ctx().log_add("tidy", &format!("Removed {folders} empty folder(s) and {links} broken shortcut(s)"), "none", None);
    }
    to_value(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("zyro-tidy-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn top_empty_folders() {
        let root = temp("a");
        std::fs::create_dir_all(root.join("empty/inner/deeper")).unwrap();
        std::fs::create_dir_all(root.join("mixed/gone")).unwrap();
        std::fs::write(root.join("mixed/file.txt"), "x").unwrap();
        std::fs::create_dir_all(root.join("full")).unwrap();
        std::fs::write(root.join("full/a.txt"), "x").unwrap();
        let (_, found) = walk(&root, Instant::now() + Duration::from_secs(5));
        let names: HashSet<String> = found.iter().map(|p| p.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(names, HashSet::from(["empty".to_string(), "mixed/gone".to_string()]));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn empty_tree() {
        let root = temp("b");
        std::fs::create_dir_all(root.join("x/y")).unwrap();
        assert!(is_empty_tree(&root.join("x")));
        std::fs::write(root.join("x/y/f"), "1").unwrap();
        assert!(!is_empty_tree(&root.join("x")));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn scan_kinds() {
        let v = scan().unwrap();
        for i in v.as_array().unwrap() {
            let id = i["id"].as_str().unwrap();
            assert!(id.starts_with("dir|") || id.starts_with("lnk|"), "{id}");
        }
    }

    #[test]
    fn offered_only() {
        let root = temp("c");
        std::fs::create_dir_all(root.join("sneaky")).unwrap();
        let r = apply(vec![format!("dir|{}", root.join("sneaky").to_string_lossy())]).unwrap();
        assert_eq!(r[0]["status"], "skipped");
        assert!(root.join("sneaky").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
