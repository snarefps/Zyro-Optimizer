use crate::model::Res;
use serde_json::{json, Value};
use std::path::Path;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";
const EPOCH_GAP_MS: u64 = 11_644_473_600_000;

fn filetime_ms(ft: u64) -> u64 {
    (ft / 10_000).saturating_sub(EPOCH_GAP_MS)
}

fn spaced(name: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in name.chars() {
        if c.is_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_lowercase();
        out.push(c);
    }
    out
}

fn app_name(raw: &str) -> String {
    let path = raw.replace('#', "\\");
    if path.contains('\\') {
        let file = Path::new(&path).file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or(path.clone());
        return file;
    }
    let base = raw.split('_').next().unwrap_or(raw);
    spaced(base.rsplit('.').next().unwrap_or(base))
}

fn usage(key: &RegKey) -> Option<(u64, bool)> {
    let start: u64 = key.get_value("LastUsedTimeStart").ok()?;
    let stop: u64 = key.get_value("LastUsedTimeStop").unwrap_or(0);
    if start == 0 {
        return None;
    }
    Some((filetime_ms(start.max(stop)), stop == 0 || start > stop))
}

fn collect(parent: &RegKey, skip: &[&str], out: &mut Vec<Value>) {
    for name in parent.enum_keys().filter_map(|k| k.ok()) {
        if skip.contains(&name.as_str()) {
            continue;
        }
        let Ok(k) = parent.open_subkey(&name) else { continue };
        if let Some((last, in_use)) = usage(&k) {
            out.push(json!({ "app": app_name(&name), "lastUsed": last, "inUse": in_use }));
        }
    }
}

fn capability(id: &str, label: &str) -> Value {
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(cap) = root.open_subkey(format!(r"{STORE}\{id}")) else {
        return json!({ "id": id, "label": label, "allowed": true, "apps": [] });
    };
    let allowed = cap.get_value::<String, _>("Value").map(|v| !v.eq_ignore_ascii_case("Deny")).unwrap_or(true);
    let mut apps = vec![];
    collect(&cap, &["NonPackaged"], &mut apps);
    if let Ok(np) = cap.open_subkey("NonPackaged") {
        collect(&np, &[], &mut apps);
    }
    apps.sort_by(|a, b| b["lastUsed"].as_u64().cmp(&a["lastUsed"].as_u64()));
    apps.truncate(10);
    json!({ "id": id, "label": label, "allowed": allowed, "apps": apps })
}

pub fn recent() -> Res<Value> {
    Ok(json!([capability("webcam", "Camera"), capability("microphone", "Microphone"), capability("location", "Location")]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names_are_readable() {
        assert_eq!(app_name("Microsoft.WindowsCamera_8wekyb3d8bbwe"), "Windows Camera");
        assert_eq!(app_name("C:#Program Files#Discord#app-1.0#Discord.exe"), "Discord");
    }

    #[test]
    fn filetimes_convert_to_unix_milliseconds() {
        assert_eq!(filetime_ms(116_444_736_000_000_000), 0);
        assert_eq!(filetime_ms(116_444_736_010_000_000), 1000);
    }

    #[test]
    fn reads_all_three_capabilities() {
        let v = recent().unwrap();
        assert_eq!(v.as_array().unwrap().len(), 3);
    }
}
