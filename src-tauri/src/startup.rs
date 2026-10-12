use crate::ctx::{ctx, is_admin};
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::registry::{self, Raw};
use crate::sysutil::{service_start, set_service_start};
use crate::undo::UndoEntry;
use crate::util::{ps_arg, run_ps, run_ps_json, str_field};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

const CURATED_SERVICES: &[&str] = &[
    "DiagTrack", "SysMain", "MapsBroker", "Fax", "RetailDemo", "WMPNetworkSvc", "XblAuthManager", "XblGameSave", "XboxNetApiSvc", "XboxGipSvc", "lfsvc",
    "PhoneSvc", "WerSvc", "dmwappushservice", "WSearch",
];

#[derive(Debug, PartialEq, Eq)]
pub enum Impact {
    High,
    Medium,
    Low,
}

impl Impact {
    fn as_str(&self) -> &'static str {
        match self {
            Impact::High => "high",
            Impact::Medium => "medium",
            Impact::Low => "low",
        }
    }
}

pub fn rate_impact(name: &str, cmd: &str) -> (Impact, bool) {
    static HIGH: OnceLock<Regex> = OnceLock::new();
    static ESSENTIAL: OnceLock<Regex> = OnceLock::new();
    let high = HIGH.get_or_init(|| {
        Regex::new(r"(?i)teams|onedrive|spotify|steam|discord|adobe|creative ?cloud|epic ?games|skype|zoom|dropbox|googledrive|cortana|java|itunes|ituneshelper|slack|origin|ubisoft|battle\.net|acrobat|ccleaner|utorrent|bittorrent|yourphone|phone ?link|xbox|razer|logitech ?g|icloud|msedge|chrome|updater?|update").unwrap()
    });
    let essential = ESSENTIAL.get_or_init(|| {
        Regex::new(r"(?i)security|defender|antivirus|realtek|nvidia|nvcontainer|intel|amd|radeon|audio|touchpad|synaptics|elan|ctfmon|igfx|rtkaud|bluetooth|wlan|wifi|ethernet|rtk|dolby|bitlocker|windows ?hello|trackpoint|lenovo ?vantage|hotkey").unwrap()
    });
    let text = format!("{name} {cmd}");
    if essential.is_match(&text) {
        (Impact::Low, true)
    } else if high.is_match(&text) {
        (Impact::High, false)
    } else {
        (Impact::Medium, false)
    }
}

fn scan_script() -> String {
    let curated = CURATED_SERVICES.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(",");
    r#"
$out = New-Object System.Collections.ArrayList
$curated = @(__CURATED__)
function IsEnabled($hive, $sub, $name) {
  $p = $hive + ':\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\' + $sub
  try { $v = (Get-ItemProperty -LiteralPath $p -ErrorAction Stop).$name } catch { return $true }
  if ($v -is [byte[]] -and $v.Length -gt 0 -and (($v[0] -band 1) -eq 1)) { return $false }
  return $true
}
$skip = @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider')
$runKeys = @(
  @{hive='HKCU'; path='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; sub='Run'},
  @{hive='HKLM'; path='HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; sub='Run'},
  @{hive='HKLM'; path='HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; sub='Run32'}
)
foreach ($k in $runKeys) {
  if (Test-Path $k.path) {
    $props = Get-ItemProperty -LiteralPath $k.path
    foreach ($p in $props.PSObject.Properties) {
      if ($skip -contains $p.Name) { continue }
      [void]$out.Add([pscustomobject]@{ src='reg'; hive=$k.hive; sub=$k.sub; name=$p.Name; cmd=[string]$p.Value; enabled=(IsEnabled $k.hive $k.sub $p.Name) })
    }
  }
}
$folders = @(@{hive='HKCU'; dir=[Environment]::GetFolderPath('Startup')}, @{hive='HKLM'; dir=[Environment]::GetFolderPath('CommonStartup')})
foreach ($f in $folders) {
  if ($f.dir -and (Test-Path $f.dir)) {
    foreach ($i in (Get-ChildItem -LiteralPath $f.dir -File | Where-Object { $_.Name -ne 'desktop.ini' })) {
      [void]$out.Add([pscustomobject]@{ src='fld'; hive=$f.hive; sub='StartupFolder'; name=$i.Name; cmd=$i.FullName; enabled=(IsEnabled $f.hive 'StartupFolder' $i.Name) })
    }
  }
}
foreach ($s in (Get-CimInstance Win32_Service)) {
  $path = [string]$s.PathName
  $third = ($path -notmatch '(?i)\\windows\\') -and ($path -notmatch '(?i)svchost') -and ($path -ne '')
  $isCur = $curated -contains $s.Name
  if ($isCur -or ($third -and $s.StartMode -eq 'Auto')) {
    if ($s.StartMode -eq 'Manual' -and -not $isCur) { continue }
    [void]$out.Add([pscustomobject]@{ src='svc'; hive=''; sub=''; name=$s.Name; cmd=([string]$s.DisplayName + ' | ' + $path); enabled=($s.StartMode -ne 'Disabled' -and $s.StartMode -ne 'Manual') })
  }
}
foreach ($t in (Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft*' })) {
  $exe = ''
  if ($t.Actions) { $exe = [string]($t.Actions | Select-Object -First 1).Execute }
  [void]$out.Add([pscustomobject]@{ src='task'; hive=''; sub=$t.TaskPath; name=$t.TaskName; cmd=$exe; enabled=($t.State -ne 'Disabled') })
}
$out
"#
    .replace("__CURATED__", &curated)
}

fn kind_label(src: &str) -> &'static str {
    match src {
        "reg" => "Startup entry",
        "fld" => "Startup folder",
        "svc" => "Service",
        _ => "Scheduled task",
    }
}

fn make_id(src: &str, hive: &str, sub: &str, name: &str) -> String {
    format!("{src}|{hive}|{sub}|{name}")
}

struct Parsed {
    src: String,
    hive: String,
    sub: String,
    name: String,
}

fn parse_id(id: &str) -> Parsed {
    let mut it = id.splitn(4, '|');
    Parsed {
        src: it.next().unwrap_or("").into(),
        hive: it.next().unwrap_or("").into(),
        sub: it.next().unwrap_or("").into(),
        name: it.next().unwrap_or("").into(),
    }
}

pub fn scan() -> Res<Value> {
    let adm = is_admin();
    let raw = run_ps_json(&scan_script(), Duration::from_secs(90))?;
    let items: Vec<ScanItem> = raw
        .iter()
        .map(|r| {
            let (src, hive, sub, name, cmd) = (str_field(r, "src"), str_field(r, "hive"), str_field(r, "sub"), str_field(r, "name"), str_field(r, "cmd"));
            let enabled = r.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let (impact, essential) = rate_impact(&name, &cmd);
            let svc_medium = src == "svc" && !CURATED_SERVICES.contains(&name.as_str());
            ScanItem::new(make_id(&src, &hive, &sub, &name), name.clone(), if essential || svc_medium { Risk::Medium } else { Risk::Low })
                .detail(cmd)
                .admin((hive == "HKLM" || src == "svc") && !adm)
                .meta(json!({ "kind": kind_label(&src), "enabled": enabled, "impact": impact.as_str(), "essential": essential }))
        })
        .collect();
    to_value(items)
}

const TASK_SCRIPT: &str = "if ($a.enable) { Enable-ScheduledTask -TaskName $a.name -TaskPath $a.sub | Out-Null } else { Disable-ScheduledTask -TaskName $a.name -TaskPath $a.sub | Out-Null }";

fn set_enabled(id: &str, enable: bool) -> Res<Option<String>> {
    let p = parse_id(id);
    match p.src.as_str() {
        "reg" | "fld" => {
            // same bytes task manager writes: 2 = on, 3 = off
            let key = format!(r"{}\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\{}", p.hive, p.sub);
            let mut b = vec![0u8; 12];
            b[0] = if enable { 2 } else { 3 };
            registry::write(&key, &p.name, &Raw::binary(b))?;
            Ok(None)
        }
        "task" => {
            run_ps(&format!("{}{}", ps_arg(&json!({ "sub": p.sub, "name": p.name, "enable": enable })), TASK_SCRIPT))?;
            Ok(None)
        }
        _ => {
            let old = service_start(&p.name).ok_or("Service not found")?;
            if enable {
                set_service_start(&p.name, "auto")?;
            } else {
                set_service_start(&p.name, if CURATED_SERVICES.contains(&p.name.as_str()) { "disabled" } else { "demand" })?;
            }
            Ok(Some(old))
        }
    }
}

fn run(ids: Vec<String>, enable: bool) -> Res<Value> {
    let adm = is_admin();
    let mut out = vec![];
    for id in ids {
        let p = parse_id(&id);
        if (p.hive == "HKLM" || p.src == "svc") && !adm {
            out.push(ItemResult::skipped(&id, "Needs administrator rights"));
            continue;
        }
        match set_enabled(&id, enable) {
            Ok(svc_old) => {
                if !enable {
                    ctx().log_add("startup", &format!("Disabled startup: {}", p.name), "startup", Some(json!({ "id": id, "svcOld": svc_old })));
                }
                out.push(ItemResult::ok(&id));
            }
            Err(e) => out.push(ItemResult::failed(&id, e)),
        }
    }
    to_value(out)
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    run(ids, false)
}

pub fn enable(ids: Vec<String>) -> Res<Value> {
    run(ids, true)
}

pub fn revert(entry: &UndoEntry) -> Res<()> {
    let u = entry.undo.clone().ok_or("Nothing to undo")?;
    let id = str_field(&u, "id");
    let p = parse_id(&id);
    match u.get("svcOld").and_then(|v| v.as_str()) {
        Some(old) if p.src == "svc" => set_service_start(&p.name, old),
        _ => set_enabled(&id, true).map(|_| ()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates_known_heavy_and_essential_items() {
        assert_eq!(rate_impact("Spotify", r"C:\x\spotify.exe").0, Impact::High);
        let (i, e) = rate_impact("RtkAudUService", r"C:\x\RtkAudUService64.exe");
        assert_eq!((i, e), (Impact::Low, true));
        assert_eq!(rate_impact("MyTool", r"C:\x\tool.exe").0, Impact::Medium);
    }

    #[test]
    fn ids_round_trip_even_with_pipes_in_names() {
        let id = make_id("reg", "HKCU", "Run", "weird|name");
        let p = parse_id(&id);
        assert_eq!((p.src.as_str(), p.hive.as_str(), p.sub.as_str(), p.name.as_str()), ("reg", "HKCU", "Run", "weird|name"));
    }

    #[test]
    fn the_scan_script_runs_for_real() {
        let v = scan().expect("scan works");
        let items = v.as_array().unwrap();
        for i in items {
            assert!(i["id"].as_str().unwrap().contains('|'));
            assert!(i["meta"]["kind"].is_string());
            assert!(i["meta"]["enabled"].is_boolean());
        }
    }

    #[test]
    fn startup_approved_toggle_round_trips_on_a_private_key() {
        let key = r"HKCU\Software\ZyroStartupApprovedTest";
        let _ = registry::delete_key(key);
        registry::write(key, "App", &Raw::binary({ let mut b = vec![0u8; 12]; b[0] = 3; b })).unwrap();
        assert_eq!(registry::read(key, "App").unwrap().bytes[0] & 1, 1); // disabled
        registry::write(key, "App", &Raw::binary({ let mut b = vec![0u8; 12]; b[0] = 2; b })).unwrap();
        assert_eq!(registry::read(key, "App").unwrap().bytes[0] & 1, 0); // enabled
        registry::delete_key(key).unwrap();
    }
}
