use crate::ctx::{ctx, PriorityRule, Schedule};
use crate::model::Res;
use crate::util::{documents_dir, now_ms};
use chrono::Local;
use serde_json::{json, Value};
use std::path::PathBuf;

fn dir() -> PathBuf {
    documents_dir().join("Zyro Backups")
}

fn valid_name(name: &str) -> bool {
    name.starts_with("zyro-settings-") && name.ends_with(".json") && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_. ".contains(c)) && !name.contains("..")
}

pub fn export(prefs: Value) -> Res<Value> {
    let s = ctx().settings();
    let body = json!({
        "app": "Zyro Optimizer",
        "version": env!("CARGO_PKG_VERSION"),
        "created": now_ms(),
        "settings": {
            "schedule": s.schedule,
            "launchAtLogin": s.launch_at_login,
            "minimizeToTray": s.minimize_to_tray,
            "autoBoost": s.auto_boost,
            "autoGames": s.auto_games,
            "priorityRules": s.priority_rules,
            "autoTrim": s.auto_trim,
            "trimPercent": s.trim_percent,
            "startupAlerts": s.startup_alerts,
            "weeklyReport": s.weekly_report
        },
        "tweaks": crate::tweaks::applied_ids(),
        "prefs": prefs
    });
    let folder = dir();
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = format!("zyro-settings-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
    let path = folder.join(&name);
    std::fs::write(&path, serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    ctx().log_add("system", "Saved a backup of the Zyro settings", "none", None);
    Ok(json!({ "name": name, "path": path.to_string_lossy() }))
}

pub fn list() -> Res<Value> {
    let mut rows: Vec<(u64, Value)> = vec![];
    for e in std::fs::read_dir(dir()).into_iter().flatten().filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        if !valid_name(&name) {
            continue;
        }
        let md = e.metadata().ok();
        let modified = md.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        rows.push((modified, json!({ "name": name, "modified": modified, "size": md.map(|m| m.len()).unwrap_or(0) })));
    }
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(Value::Array(rows.into_iter().map(|r| r.1).take(20).collect()))
}

pub fn folder() -> Res<Value> {
    let folder = dir();
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let _ = std::process::Command::new("explorer.exe").arg(&folder).spawn();
    Ok(Value::Null)
}

pub fn import(name: String) -> Res<Value> {
    if !valid_name(&name) {
        return Err("That is not a Zyro backup file".into());
    }
    let text = std::fs::read_to_string(dir().join(&name)).map_err(|_| "The backup file could not be read".to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|_| "The backup file is damaged".to_string())?;
    if v["app"] != "Zyro Optimizer" {
        return Err("That is not a Zyro backup file".into());
    }
    let s = &v["settings"];
    if let Ok(schedule) = serde_json::from_value::<Schedule>(s["schedule"].clone()) {
        crate::scheduler::set_schedule(schedule)?;
    }
    let flag = |k: &str| s[k].as_bool();
    ctx().update_settings(|c| {
        if let Some(b) = flag("minimizeToTray") {
            c.minimize_to_tray = b;
        }
        if let Some(b) = flag("autoTrim") {
            c.auto_trim = b;
        }
        if let Some(b) = flag("startupAlerts") {
            c.startup_alerts = b;
        }
        if let Some(b) = flag("weeklyReport") {
            c.weekly_report = b;
        }
        if let Some(n) = s["trimPercent"].as_u64() {
            c.trim_percent = (n as u32).clamp(60, 95);
        }
    });
    if let Some(b) = flag("launchAtLogin") {
        crate::system::set_setting("launchAtLogin".into(), b)?;
    }
    let games: Vec<String> = s["autoGames"].as_array().map(|a| a.iter().filter_map(|g| g.as_str().map(String::from)).collect()).unwrap_or_default();
    crate::gamebooster::set_auto(flag("autoBoost").unwrap_or(false), games)?;
    let rules: Vec<PriorityRule> = serde_json::from_value(s["priorityRules"].clone()).unwrap_or_default();
    crate::gamebooster::set_rules(rules)?;
    let ids: Vec<String> = v["tweaks"].as_array().map(|a| a.iter().filter_map(|g| g.as_str().map(String::from)).collect()).unwrap_or_default();
    let results = crate::tweaks::apply(ids)?;
    let done = results.as_array().map(|r| r.iter().filter(|x| x["status"] == "ok").count()).unwrap_or(0);
    let skipped = results.as_array().map(|r| r.iter().filter(|x| x["status"] == "skipped").count()).unwrap_or(0);
    ctx().log_add("system", &format!("Restored the Zyro settings from {name}"), "none", None);
    Ok(json!({ "ok": true, "prefs": v["prefs"], "tweaksApplied": done, "tweaksSkipped": skipped }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_zyro_backup_names_are_accepted() {
        assert!(valid_name("zyro-settings-20261115-120000.json"));
        for bad in ["../x.json", "settings.json", "zyro-settings-..\\x.json", "zyro-settings-1.txt", "zyro-settings-1/../a.json"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }
}
