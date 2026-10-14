use crate::model::Res;
use crate::registry;
use crate::util::run_exe;
use regex::Regex;

pub fn service_start(name: &str) -> Option<String> {
    if name.is_empty() || name.contains(['\\', '/']) {
        return None;
    }
    let key = format!(r"HKLM\SYSTEM\CurrentControlSet\Services\{name}");
    let start = registry::read(&key, "Start")?.as_dword()?;
    match start {
        2 if registry::read(&key, "DelayedAutostart").and_then(|v| v.as_dword()) == Some(1) => Some("delayed-auto".into()),
        2 => Some("auto".into()),
        3 => Some("demand".into()),
        4 => Some("disabled".into()),
        _ => None,
    }
}

pub fn service_running(name: &str) -> bool {
    run_exe("sc.exe", &["query", name]).map(|o| Regex::new(r"(?i)\b4\s+running\b").map(|re| re.is_match(&o)).unwrap_or(false)).unwrap_or(false)
}

pub fn stop_service(name: &str) {
    let _ = run_exe("sc.exe", &["stop", name]);
}

pub fn start_service(name: &str) {
    let _ = run_exe("sc.exe", &["start", name]);
}

pub fn set_service_start(name: &str, start: &str) -> Res<()> {
    run_exe("sc.exe", &["config", name, "start=", start])?;
    if start == "disabled" {
        stop_service(name);
    }
    if start == "auto" || start == "delayed-auto" {
        start_service(name);
    }
    Ok(())
}

pub const GUID_HIGH: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
pub const GUID_ULTIMATE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";

pub fn active_power() -> Option<(String, String)> {
    let out = run_exe("powercfg", &["/getactivescheme"]).ok()?;
    let re = Regex::new(r"(?i)([0-9a-f]{8}-[0-9a-f-]{27})\s*\(([^)]*)\)").ok()?;
    let c = re.captures(&out)?;
    Some((c[1].to_lowercase(), c[2].to_string()))
}

pub fn set_active_plan(guid: &str) -> Res<()> {
    run_exe("powercfg", &["/setactive", guid]).map(|_| ())
}

pub fn activate_plan(ultimate: bool) -> Res<()> {
    let guid = if ultimate { GUID_ULTIMATE } else { GUID_HIGH };
    if set_active_plan(guid).is_ok() {
        return Ok(());
    }
    let out = run_exe("powercfg", &["-duplicatescheme", guid])?;
    let re = Regex::new(r"(?i)([0-9a-f]{8}-[0-9a-f-]{27})").map_err(|e| e.to_string())?;
    let c = re.captures(&out).ok_or("Could not create power plan")?;
    set_active_plan(&c[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_service_query_works() {
        assert_eq!(service_start("EventLog").as_deref(), Some("auto"));
        assert!(service_start("ZyroNoSuchService").is_none());
        assert!(service_start(r"..\Evil").is_none());
        assert!(service_start("").is_none());
        let sc = run_exe("sc.exe", &["qc", "Spooler"]).unwrap_or_default();
        let from_sc = if sc.contains("DEMAND_START") { "demand" } else if sc.contains("DISABLED") { "disabled" } else if sc.contains("DELAYED") { "delayed-auto" } else { "auto" };
        assert_eq!(service_start("Spooler").as_deref(), Some(from_sc));
    }

    #[test]
    fn reports_whether_a_service_is_running() {
        assert!(service_running("EventLog"));
        assert!(!service_running("ZyroNoSuchService"));
    }

    #[test]
    fn reads_the_active_power_plan() {
        let (guid, name) = active_power().expect("a plan is always active");
        assert_eq!(guid.len(), 36);
        assert!(!name.is_empty());
    }
}
