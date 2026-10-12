use crate::model::Res;
use crate::util::run_exe;
use regex::Regex;

pub fn parse_service_start(out: &str) -> Option<String> {
    let re = Regex::new(r"START_TYPE\s*:\s*(\d+)\s*(.*)").ok()?;
    let c = re.captures(out)?;
    let tail = c.get(2).map(|m| m.as_str()).unwrap_or("");
    match &c[1] {
        "2" if tail.to_uppercase().contains("DELAYED") => Some("delayed-auto".into()),
        "2" => Some("auto".into()),
        "3" => Some("demand".into()),
        "4" => Some("disabled".into()),
        _ => None,
    }
}

pub fn service_start(name: &str) -> Option<String> {
    run_exe("sc.exe", &["qc", name]).ok().and_then(|o| parse_service_start(&o))
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
    fn reads_service_start_types() {
        assert_eq!(parse_service_start("        START_TYPE         : 2   AUTO_START").as_deref(), Some("auto"));
        assert_eq!(parse_service_start("        START_TYPE         : 2   AUTO_START  (DELAYED)").as_deref(), Some("delayed-auto"));
        assert_eq!(parse_service_start("        START_TYPE         : 3   DEMAND_START").as_deref(), Some("demand"));
        assert_eq!(parse_service_start("        START_TYPE         : 4   DISABLED").as_deref(), Some("disabled"));
        assert_eq!(parse_service_start("The specified service does not exist"), None);
    }

    #[test]
    fn real_service_query_works() {
        assert!(service_start("EventLog").is_some());
        assert!(service_start("ZyroNoSuchService").is_none());
    }

    #[test]
    fn reads_the_active_power_plan() {
        let (guid, name) = active_power().expect("a plan is always active");
        assert_eq!(guid.len(), 36);
        assert!(!name.is_empty());
    }
}
