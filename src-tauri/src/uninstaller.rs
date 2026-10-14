use crate::ctx::ctx;
use crate::fsx::dir_size;
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::util::{run_ps_json, str_field};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

const SCRIPT: &str = r#"
$keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName -and $_.UninstallString } | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate, EstimatedSize, UninstallString, InstallLocation, PSChildName
"#;

static COMMANDS: Mutex<Option<HashMap<String, (String, String)>>> = Mutex::new(None);
static OFFERED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn scan_items() -> Res<Vec<ScanItem>> {
    let raw = run_ps_json(SCRIPT, Duration::from_secs(60))?;
    let mut cmds: HashMap<String, (String, String)> = HashMap::new();
    let mut seen = HashSet::new();
    let mut items = vec![];
    for a in &raw {
        let (name, ver, id) = (str_field(a, "DisplayName"), str_field(a, "DisplayVersion"), str_field(a, "PSChildName"));
        if !seen.insert(format!("{name}|{ver}")) {
            continue;
        }
        cmds.insert(id.clone(), (str_field(a, "UninstallString"), name.clone()));
        let d = str_field(a, "InstallDate");
        let date = if d.len() == 8 && d.chars().all(|c| c.is_ascii_digit()) { format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..]) } else { String::new() };
        let publisher = str_field(a, "Publisher");
        let detail: Vec<String> = [
            (!publisher.is_empty()).then(|| publisher.clone()),
            (!ver.is_empty()).then(|| format!("v{ver}")),
            (!date.is_empty()).then(|| format!("installed {date}")),
        ]
        .into_iter()
        .flatten()
        .collect();
        let mut item = ScanItem::new(id, name, Risk::Low)
            .detail(detail.join("  ·  "))
            .meta(json!({ "publisher": publisher, "installDate": date, "location": str_field(a, "InstallLocation") }));
        if let Some(kb) = a.get("EstimatedSize").and_then(|v| v.as_u64()).filter(|k| *k > 0) {
            item = item.size(kb * 1024);
        }
        items.push(item);
    }
    items.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    *COMMANDS.lock().unwrap_or_else(|e| e.into_inner()) = Some(cmds);
    Ok(items)
}

pub fn scan() -> Res<Value> {
    to_value(scan_items()?)
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let mut out = vec![];
    for id in ids {
        let found = COMMANDS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&id).cloned());
        let Some((cmd, name)) = found else {
            out.push(ItemResult::failed(&id, "Run a scan first"));
            continue;
        };
        match Command::new("cmd.exe").raw_arg(format!("/d /s /c \"{cmd}\"")).spawn() {
            Ok(_) => {
                ctx().log_add("uninstaller", &format!("Started uninstaller: {name}"), "none", None);
                out.push(ItemResult::ok_note(&id, "Uninstaller started. Follow its window."));
            }
            Err(e) => out.push(ItemResult::failed(&id, e.to_string())),
        }
    }
    to_value(out)
}

const RESERVED: &[&str] = &[
    "common files", "windowsapps", "windows defender", "windows defender advanced threat protection", "microsoft", "microsoft.net", "internet explorer", "windows nt",
    "windows mail", "windows media player", "windows photo viewer", "windows security", "windowspowershell", "modifiableswindowsapps", "reference assemblies", "msbuild",
    "package cache", "packages", "temp", "programs", "google", "mozilla", "nvidia corporation", "intel", "amd", "uninstall information", "application data", "desktop",
    "documents", "oracle", "apple", "adobe",
];

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

fn roots() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "APPDATA", "ProgramData"].iter().filter_map(|k| std::env::var(k).ok()).map(PathBuf::from).collect()
}

fn is_leftover_candidate(folder: &str, app: &str) -> bool {
    if RESERVED.contains(&folder.to_lowercase().as_str()) {
        return false;
    }
    let (f, a) = (norm(folder), norm(app));
    if f.len() < 5 || a.len() < 5 {
        return false;
    }
    f == a || a.starts_with(&f) || f.starts_with(&a)
}

pub fn leftovers(app_name: String) -> Res<Value> {
    if scan_items()?.iter().any(|i| norm(&i.label) == norm(&app_name)) {
        return to_value(Vec::<ScanItem>::new());
    }
    let mut items = vec![];
    for root in roots() {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let n = e.file_name().to_string_lossy().to_string();
            if !is_leftover_candidate(&n, &app_name) {
                continue;
            }
            let full = e.path();
            let label = full.to_string_lossy().to_string();
            items.push(ScanItem::new(label.clone(), label, Risk::Medium).detail("Possible leftover folder").size(dir_size(&full)));
        }
    }
    *OFFERED.lock().unwrap_or_else(|e| e.into_inner()) = Some(items.iter().map(|i| i.id.to_lowercase()).collect());
    to_value(items)
}

pub fn remove_leftovers(paths: Vec<String>) -> Res<Value> {
    let roots: HashSet<String> = roots().iter().map(|r| r.to_string_lossy().to_lowercase()).collect();
    let mut out = vec![];
    let mut removed = 0;
    for p in paths {
        let path = PathBuf::from(&p);
        let parent = path.parent().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        let offered = OFFERED.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|o| o.contains(&p.to_lowercase()));
        if !offered || !roots.contains(&parent) || RESERVED.contains(&name.as_str()) {
            out.push(ItemResult::skipped(&p, "Not a removable leftover location"));
            continue;
        }
        match std::fs::remove_dir_all(&path) {
            Ok(_) => {
                removed += 1;
                out.push(ItemResult::ok(&p));
            }
            Err(e) => out.push(ItemResult::failed(&p, e.to_string())),
        }
    }
    if removed > 0 {
        ctx().log_add("uninstaller", &format!("Removed {removed} leftover folder(s)"), "none", None);
    }
    to_value(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leftover_matching_is_conservative() {
        assert!(is_leftover_candidate("VLC media player", "VLC media player"));
        assert!(is_leftover_candidate("Notepad Plus", "Notepad Plus Plus Pro"), "folder name that prefixes the app name matches");
        assert!(!is_leftover_candidate("Microsoft", "Microsoft Edge"), "reserved names never match");
        assert!(!is_leftover_candidate("Go", "Google Chrome"), "short names never match");
        assert!(!is_leftover_candidate("Common Files", "Common Files"));
    }

    #[test]
    fn refuses_to_remove_outside_the_known_roots() {
        let v = remove_leftovers(vec![r"C:\Windows\System32".into(), r"C:\Users".into()]).unwrap();
        for r in v.as_array().unwrap() {
            assert_eq!(r["status"], "skipped");
        }
    }
}
