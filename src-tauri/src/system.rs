use crate::ctx::{ctx, is_admin};
use crate::model::{to_value, Res};
use crate::undo::UndoEntry;
use crate::util::{ps_arg, run_ps, run_ps_json, run_ps_timeout};
use serde_json::{json, Value};
use std::time::Duration;
use tauri_plugin_autostart::ManagerExt;

fn friendly_restore_error(raw: &str) -> String {
    let l = raw.to_lowercase();
    if l.contains("disabled") || l.contains("turned off") || l.contains("not enabled") {
        "System Protection is turned off for the system drive. Turn it on in Windows (System Protection) to use restore points".into()
    } else {
        raw.lines().find(|x| !x.trim().is_empty()).unwrap_or("Failed").trim().chars().take(200).collect()
    }
}

fn create_restore_point_raw(description: &str) -> Result<(), String> {
    if !is_admin() {
        return Err("Needs administrator rights".into());
    }
    let desc: String = description.chars().take(120).collect();
    let script = format!(
        "{}{}",
        ps_arg(&json!({ "desc": desc })),
        r#"
$k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
$n = 'SystemRestorePointCreationFrequency'
$old = $null
try { $old = (Get-ItemProperty -Path $k -Name $n -ErrorAction Stop).$n } catch {}
Set-ItemProperty -Path $k -Name $n -Value 0 -Type DWord
try { Checkpoint-Computer -Description $a.desc -RestorePointType MODIFY_SETTINGS -ErrorAction Stop }
finally {
  if ($null -eq $old) { Remove-ItemProperty -Path $k -Name $n -ErrorAction SilentlyContinue }
  else { Set-ItemProperty -Path $k -Name $n -Value $old -Type DWord }
}
"#
    );
    run_ps_timeout(&script, Duration::from_secs(180)).map(|_| ()).map_err(|e| friendly_restore_error(&e))
}

pub fn create_restore_point() -> Res<Value> {
    Ok(match create_restore_point_raw("Zyro Optimizer - manual restore point") {
        Ok(()) => json!({ "created": true }),
        Err(e) => json!({ "created": false, "reason": e }),
    })
}

pub fn list_restore_points() -> Res<Value> {
    if !is_admin() {
        return Ok(json!({ "ok": false, "reason": "Needs administrator rights" }));
    }
    let script = "Get-ComputerRestorePoint | Sort-Object SequenceNumber -Descending | Select-Object Description, SequenceNumber, RestorePointType, @{n='Created';e={[Management.ManagementDateTimeConverter]::ToDateTime($_.CreationTime).ToString('o')}}";
    match run_ps_json(script, Duration::from_secs(60)) {
        Ok(rows) => {
            let points: Vec<Value> = rows
                .iter()
                .map(|r| {
                    let d = r.get("Description").and_then(|v| v.as_str()).unwrap_or("");
                    json!({
                        "seq": r.get("SequenceNumber").cloned().unwrap_or(Value::Null),
                        "description": d,
                        "created": r.get("Created").cloned().unwrap_or(Value::Null),
                        "byZyro": d.starts_with("Zyro Optimizer")
                    })
                })
                .collect();
            Ok(json!({ "ok": true, "points": points }))
        }
        Err(e) => Ok(json!({ "ok": false, "reason": friendly_restore_error(&e) })),
    }
}

fn remove_restore_point(seq: u32) -> Result<(), String> {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    let name: Vec<u16> = "srclient.dll\0".encode_utf16().collect();
    unsafe {
        let lib = LoadLibraryW(name.as_ptr());
        if lib.is_null() {
            return Err("System Restore is not available on this PC".into());
        }
        let Some(func) = GetProcAddress(lib, b"SRRemoveRestorePoint\0".as_ptr()) else {
            return Err("System Restore is not available on this PC".into());
        };
        let remove: unsafe extern "system" fn(u32) -> u32 = std::mem::transmute(func);
        match remove(seq) {
            0 => Ok(()),
            2 | 1168 => Err("That restore point no longer exists".into()),
            5 => Err("Windows refused. Run Zyro as administrator".into()),
            code => Err(format!("Windows could not remove it (error {code})")),
        }
    }
}

pub fn delete_restore_point(seq: u64) -> Res<Value> {
    if !is_admin() {
        return Ok(json!({ "ok": false, "reason": "Needs administrator rights" }));
    }
    let seq = u32::try_from(seq).map_err(|_| "Invalid restore point".to_string())?;
    Ok(match remove_restore_point(seq) {
        Ok(()) => {
            ctx().log_add("system", &format!("Deleted restore point {seq}"), "none", None);
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "reason": e }),
    })
}

pub fn open_system_restore() -> Res<Value> {
    std::process::Command::new("rstrui.exe").spawn().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

fn open_url(url: &str) -> Res<Value> {
    std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]).spawn().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn open_telegram() -> Res<Value> {
    open_url("https://t.me/ZeroNullex")
}

pub fn open_github() -> Res<Value> {
    open_url("https://github.com/snarefps/Zyro-Optimizer")
}

pub fn open_releases() -> Res<Value> {
    open_url("https://github.com/snarefps/Zyro-Optimizer/releases/latest")
}

fn version_parts(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+']).map_while(|p| p.parse::<u64>().ok()).collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let (a, b) = (version_parts(latest), version_parts(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

struct Release {
    tag: String,
    notes: String,
    published: String,
}

fn fetch_latest() -> Res<Release> {
    let script = "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;\
        $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/snarefps/Zyro-Optimizer/releases/latest' -Headers @{ 'User-Agent'='ZyroOptimizer'; 'Accept'='application/vnd.github+json' } -TimeoutSec 15;\
        @{ tag = [string]$r.tag_name; notes = [string]$r.body; published = [string]$r.published_at } | ConvertTo-Json -Compress";
    let out = crate::util::run_ps_timeout(script, std::time::Duration::from_secs(25)).map_err(|e| format!("The update server could not be reached ({e})"))?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|_| "The update answer could not be read".to_string())?;
    let tag = crate::util::str_field(&v, "tag");
    if tag.is_empty() {
        return Err("No release has been published yet".into());
    }
    Ok(Release { tag, notes: crate::util::str_field(&v, "notes"), published: crate::util::str_field(&v, "published") })
}

pub fn check_update() -> Res<Value> {
    let current = env!("CARGO_PKG_VERSION");
    let r = fetch_latest()?;
    Ok(json!({
        "current": current,
        "latest": r.tag.trim_start_matches(['v', 'V']),
        "available": is_newer(&r.tag, current),
        "notes": r.notes.chars().take(1200).collect::<String>(),
        "published": r.published,
    }))
}

fn checksum_in(notes: &str) -> Option<String> {
    regex::Regex::new(r"\b[0-9a-fA-F]{64}\b").ok()?.find(notes).map(|m| m.as_str().to_lowercase())
}

fn sha256_hex(path: &std::path::Path) -> Res<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn install_update() -> Res<Value> {
    let step = |m: &str| crate::ctx::emit("update:progress", json!({ "message": m }));
    step("Looking for the newest version...");
    let release = fetch_latest()?;
    let current = env!("CARGO_PKG_VERSION");
    if !is_newer(&release.tag, current) {
        return Ok(json!({ "ok": false, "reason": "You already have the newest version" }));
    }
    let valid_tag = regex::Regex::new(r"^v?\d+\.\d+\.\d+$").map_err(|e| e.to_string())?;
    if !valid_tag.is_match(&release.tag) {
        return Ok(json!({ "ok": false, "reason": "The newest release has an unexpected name, so Zyro will not download it" }));
    }
    let Some(expected) = checksum_in(&release.notes) else {
        return Ok(json!({ "ok": false, "reason": "The release notes do not list a checksum, so Zyro cannot verify the download. Download it from the releases page instead" }));
    };
    let dir = std::env::temp_dir().join("ZyroUpdate");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("Zyro-Optimizer-{}-setup.exe", release.tag.trim_start_matches(['v', 'V'])));
    let url = format!("https://github.com/snarefps/Zyro-Optimizer/releases/download/{}/Zyro-Optimizer-x64-setup.exe", release.tag);
    step("Downloading the installer...");
    let script = format!(
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -Uri '{url}' -OutFile '{}' -UseBasicParsing -TimeoutSec 300",
        file.to_string_lossy().replace('\'', "''")
    );
    run_ps_timeout(&script, Duration::from_secs(330)).map_err(|e| format!("The download failed ({})", e.lines().next().unwrap_or("unknown error")))?;
    step("Checking the download...");
    let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    if size < 100_000 {
        let _ = std::fs::remove_file(&file);
        return Ok(json!({ "ok": false, "reason": "The downloaded file is too small to be the installer" }));
    }
    if sha256_hex(&file)? != expected {
        let _ = std::fs::remove_file(&file);
        return Ok(json!({ "ok": false, "reason": "The download does not match the checksum in the release notes. It was deleted" }));
    }
    step("Starting the installer...");
    std::process::Command::new(&file).spawn().map_err(|e| format!("Could not start the installer: {e}"))?;
    ctx().log_add("system", &format!("Started the installer for version {}", release.tag.trim_start_matches(['v', 'V'])), "none", None);
    let app = ctx().app().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        app.exit(0);
    });
    Ok(json!({ "ok": true }))
}

pub fn notify(body: String) -> Res<Value> {
    crate::scheduler::notify(&body.chars().take(200).collect::<String>());
    Ok(Value::Null)
}

pub fn log_error(source: String, message: String) -> Res<Value> {
    crate::errlog::record(&source.chars().take(40).collect::<String>(), &message);
    Ok(Value::Null)
}

pub fn relaunch_as_admin() -> Res<Value> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--wait-pid").map(|a| format!("\"{a}\"")).collect();
    args.push(format!("--wait-pid {}", std::process::id()));
    let script = format!(
        "{}Start-Process -FilePath $a.exe -ArgumentList $a.args -Verb RunAs",
        ps_arg(&json!({ "exe": exe.to_string_lossy(), "args": args.join(" ") }))
    );
    match run_ps(&script) {
        Ok(_) => {
            let app = ctx().app().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(250));
                app.exit(0);
            });
            Ok(json!({ "ok": true }))
        }
        Err(_) => Ok(json!({ "ok": false, "reason": "Elevation was cancelled" })),
    }
}

pub fn get_settings() -> Res<Value> {
    let s = ctx().settings();
    Ok(json!({
        "launchAtLogin": s.launch_at_login,
        "minimizeToTray": s.minimize_to_tray,
        "autoTrim": s.auto_trim,
        "trimPercent": s.trim_percent,
        "startupAlerts": s.startup_alerts,
        "weeklyReport": s.weekly_report
    }))
}

pub fn set_setting(key: String, value: bool) -> Res<Value> {
    match key.as_str() {
        "launchAtLogin" => {
            let auto = ctx().app().autolaunch();
            let r = if value { auto.enable() } else { auto.disable() };
            r.map_err(|e| e.to_string())?;
            ctx().update_settings(|s| s.launch_at_login = value);
        }
        "minimizeToTray" => ctx().update_settings(|s| s.minimize_to_tray = value),
        "autoTrim" => ctx().update_settings(|s| s.auto_trim = value),
        "startupAlerts" => ctx().update_settings(|s| s.startup_alerts = value),
        "weeklyReport" => ctx().update_settings(|s| {
            s.weekly_report = value;
            s.last_report = if value { crate::util::now_ms() } else { 0 };
        }),
        _ => return Err("Unknown setting".into()),
    }
    get_settings()
}

pub fn set_number(key: String, value: u64) -> Res<Value> {
    match key.as_str() {
        "trimPercent" => ctx().update_settings(|s| s.trim_percent = (value as u32).clamp(60, 95)),
        _ => return Err("Unknown setting".into()),
    }
    get_settings()
}

pub fn history_list() -> Res<Value> {
    to_value(ctx().log_list().into_iter().take(300).collect::<Vec<UndoEntry>>())
}

pub fn history_revert(id: String) -> Res<Value> {
    let Some(entry) = ctx().log_get(&id) else { return Ok(json!({ "ok": false, "reason": "Entry not found" })) };
    if entry.reverted {
        return Ok(json!({ "ok": false, "reason": "Already reverted" }));
    }
    let r = match entry.kind.as_str() {
        "registry" => crate::tweaks::revert_tweak(&entry),
        "startup" => crate::startup::revert(&entry),
        "appx" => crate::debloat::revert(&entry),
        "dns" => crate::dns::revert(&entry),
        "appver" => crate::updates::revert(&entry),
        "hosts" => crate::net::revert_hosts(&entry),
        _ => Err("This action cannot be undone automatically".to_string()),
    };
    Ok(match r {
        Ok(()) => {
            ctx().log_mark_reverted(&id);
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "reason": e }),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn compares_versions_numerically() {
        assert!(super::is_newer("v1.3.0", "1.2.0"));
        assert!(super::is_newer("1.2.10", "1.2.9"));
        assert!(!super::is_newer("1.2.0", "1.2.0"));
        assert!(!super::is_newer("1.1.9", "1.2.0"));
        assert!(super::is_newer("1.2.0.1", "1.2.0"));
    }

    use super::*;

    #[test]
    fn restore_errors_are_made_readable() {
        assert!(friendly_restore_error("System Restore is disabled on this computer").contains("System Protection"));
        assert_eq!(friendly_restore_error("\n  Something else failed \nmore"), "Something else failed");
    }
}
