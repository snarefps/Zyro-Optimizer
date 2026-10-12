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
        "System Protection is turned off for the system drive. Turn it on in Windows (System Protection) to use restore points.".into()
    } else {
        raw.lines().find(|x| !x.trim().is_empty()).unwrap_or("Failed").trim().chars().take(200).collect()
    }
}

// windows allows one restore point a day; lift the limit for this call and put it back after
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

// srclient.dll has no PowerShell cmdlet, so call SRRemoveRestorePoint directly
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

// only fixed addresses, the UI can not ask for an arbitrary one
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

// the new copy gets our pid and waits for us to exit, otherwise the single-instance check kills it
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
    Ok(json!({ "launchAtLogin": s.launch_at_login, "minimizeToTray": s.minimize_to_tray }))
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
    use super::*;

    #[test]
    fn restore_errors_are_made_readable() {
        assert!(friendly_restore_error("System Restore is disabled on this computer").contains("System Protection"));
        assert_eq!(friendly_restore_error("\n  Something else failed \nmore"), "Something else failed");
    }
}
