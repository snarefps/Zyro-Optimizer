use crate::ctx::{ctx, is_admin};
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::monitor::memory;
use crate::processes::{self, snapshot};
use crate::sysutil::{activate_plan, active_power, service_start, set_active_plan, start_service, stop_service};
use crate::util::{now_ms, ps_arg, run_ps};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::{Command, Stdio};

const KNOWN_HOGS: &str = r"(?i)^(onedrive|teams|ms-teams|msteams|skype|skypeapp|dropbox|googledrivefs|adobeupdateservice|creative cloud|ccxprocess|cclibrary|adobe desktop service|spotify|yourphone|phoneexperiencehost|widgets|msedgewebview2|outlook|olk|slack|zoom|whatsapp|telegram|icloudservices|itunes)$";
const NEVER_CLOSE: &[&str] = &[
    "node", "electron", "pwsh", "powershell", "cmd", "windowsterminal", "wt", "code", "devenv", "git", "zyro optimizer", "zyro-optimizer", "openconsole", "bash", "conhost",
];
const PAUSE_SERVICES: &[&str] = &["SysMain", "WSearch", "DiagTrack", "wuauserv"];

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Closed {
    name: String,
    path: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
struct BoostState {
    active: bool,
    started_at: u64,
    prev_plan: Option<String>,
    stopped_services: Vec<String>,
    closed: Vec<Closed>,
    free_before: u64,
}

fn state_path() -> std::path::PathBuf {
    ctx().data_dir.join("gamebooster.json")
}

fn load() -> BoostState {
    std::fs::read_to_string(state_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(s: &BoostState) {
    if let Ok(t) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(state_path(), t);
    }
}

fn never_close(name: &str) -> bool {
    let n = name.to_lowercase();
    NEVER_CLOSE.contains(&n.as_str()) || processes::is_critical(&n)
}

pub fn scan() -> Res<Value> {
    let admin = is_admin();
    let hogs = Regex::new(KNOWN_HOGS).map_err(|e| e.to_string())?;
    #[derive(Default)]
    struct Agg {
        count: u32,
        mem: u64,
        window: bool,
        path: String,
    }
    let mut by_name: HashMap<String, Agg> = HashMap::new();
    for p in snapshot() {
        let Some(path) = p.path.clone() else { continue };
        if p.protected || never_close(&p.name) || path.to_lowercase().contains(r"\windows\") {
            continue;
        }
        let a = by_name.entry(p.name.clone()).or_default();
        a.count += 1;
        a.mem += p.mem_bytes;
        a.window |= p.has_window;
        if a.path.is_empty() {
            a.path = path;
        }
    }
    let mut items = vec![
        ScanItem::new("opt:power", "Switch to High Performance power plan", Risk::Low).detail("Restored when you stop the boost"),
        ScanItem::new("opt:services", "Pause background services", Risk::Low)
            .detail("Search indexing, Superfetch, telemetry and Windows Update pause until you stop the boost")
            .admin(!admin),
        ScanItem::new("opt:trim", "Free up RAM", Risk::Safe).detail("Shrinks idle memory held by background processes"),
    ];
    let mut procs: Vec<ScanItem> = by_name
        .into_iter()
        .filter(|(name, a)| a.mem >= 40 * 1_048_576 || hogs.is_match(name))
        .map(|(name, a)| {
            let suggested = hogs.is_match(&name);
            ScanItem::new(format!("proc:{name}"), name.clone(), if a.window { Risk::Medium } else { Risk::Low })
                .detail(if a.window {
                    format!("{} process(es). Has an open window and will be asked to close", a.count)
                } else {
                    format!("{} background process(es)", a.count)
                })
                .size(a.mem)
                .meta(json!({ "suggested": suggested, "path": a.path, "hasWindow": a.window }))
        })
        .collect();
    procs.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    items.extend(procs);
    to_value(items)
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let admin = is_admin();
    let mut s = load();
    if !s.active {
        s.active = true;
        s.started_at = now_ms();
        s.free_before = memory().1;
    }
    let mut out = vec![];
    for id in ids {
        let r: Res<ItemResult> = (|| {
            if id == "opt:power" {
                if s.prev_plan.is_none() {
                    s.prev_plan = active_power().map(|(g, _)| g);
                }
                activate_plan(false)?;
                Ok(ItemResult::ok(&id))
            } else if id == "opt:services" {
                if !admin {
                    return Ok(ItemResult::skipped(&id, "Needs administrator rights"));
                }
                for name in PAUSE_SERVICES {
                    if s.stopped_services.iter().any(|x| x == name) {
                        continue;
                    }
                    if matches!(service_start(name).as_deref(), Some(st) if st != "disabled") {
                        stop_service(name);
                        s.stopped_services.push((*name).to_string());
                    }
                }
                Ok(ItemResult::ok(&id))
            } else if id == "opt:trim" {
                let (freed, _) = processes::trim_memory_raw();
                Ok(ItemResult::ok(&id).freed(freed))
            } else if let Some(name) = id.strip_prefix("proc:") {
                if never_close(name) {
                    return Ok(ItemResult::skipped(&id, "Protected process"));
                }
                if let Some(path) = snapshot().into_iter().find(|p| p.name == name).and_then(|p| p.path) {
                    if !s.closed.iter().any(|c| c.name == name) {
                        s.closed.push(Closed { name: name.to_string(), path });
                    }
                }
                // apps with a window get a close request, background ones are killed
                run_ps(&format!(
                    "{}foreach ($p in (Get-Process -Name $a.n -ErrorAction SilentlyContinue)) {{ if ($p.MainWindowHandle -ne 0) {{ [void]$p.CloseMainWindow() }} else {{ Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }} }}",
                    ps_arg(&json!({ "n": name }))
                ))?;
                Ok(ItemResult::ok(&id))
            } else {
                Ok(ItemResult::failed(&id, "Unknown option"))
            }
        })();
        out.push(r.unwrap_or_else(|e| ItemResult::failed(&id, e)));
    }
    save(&s);
    ctx().log_add("gamebooster", "Game Booster started", "none", None);
    to_value(out)
}

pub fn status() -> Res<Value> {
    let s = load();
    Ok(json!({
        "active": s.active,
        "startedAt": s.started_at,
        "closed": s.closed.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
        "pausedServices": s.stopped_services,
        "freeBefore": s.free_before
    }))
}

pub fn restore() -> Res<Value> {
    let s = load();
    let (mut restored, mut failed): (Vec<String>, Vec<String>) = (vec![], vec![]);
    if let Some(g) = &s.prev_plan {
        if set_active_plan(g).is_ok() { restored.push("Power plan".into()) } else { failed.push("Power plan".into()) }
    }
    for svc in &s.stopped_services {
        start_service(svc);
        restored.push(format!("Service {svc}"));
    }
    for c in &s.closed {
        if !std::path::Path::new(&c.path).exists() {
            failed.push(c.name.clone());
            continue;
        }
        match Command::new(&c.path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(_) => restored.push(c.name.clone()),
            Err(_) => failed.push(c.name.clone()),
        }
    }
    let _ = std::fs::remove_file(state_path());
    Ok(json!({ "restored": restored, "failed": failed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_dev_tools_and_system_processes() {
        for n in ["Node", "powershell", "explorer", "svchost", "Zyro Optimizer"] {
            assert!(never_close(n), "{n}");
        }
        assert!(!never_close("Spotify"));
    }

    #[test]
    fn known_hog_pattern_matches_whole_names_only() {
        let re = Regex::new(KNOWN_HOGS).unwrap();
        assert!(re.is_match("OneDrive") && re.is_match("Spotify"));
        assert!(!re.is_match("OneDriveXYZ") && !re.is_match("game"));
    }
}
