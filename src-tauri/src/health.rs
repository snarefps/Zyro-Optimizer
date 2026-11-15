use crate::ctx::{ctx, is_admin};
use crate::model::Res;
use crate::util::{documents_dir, run_ps, run_ps_json, run_ps_timeout};
use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

const WINDOWS_BOOTS: &str = r#"
Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'; Id = 100 } -MaxEvents 12 -ErrorAction Stop | ForEach-Object {
  $x = [xml]$_.ToXml()
  $d = @{}
  foreach ($n in $x.Event.EventData.Data) { $d[$n.Name] = $n.'#text' }
  [pscustomobject]@{ at = $_.TimeCreated.ToString('o'); bootMs = [int64]$d['BootTime']; mainMs = [int64]$d['MainPathBootTime']; postMs = [int64]$d['BootPostBootTime']; kind = 'Windows' }
}
"#;

const SYSTEM_STARTS: &str = r#"
$starts = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Boot'; Id = 27 } -MaxEvents 14 -ErrorAction Stop
$logons = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Winlogon'; Id = 7001 } -MaxEvents 60 -ErrorAction SilentlyContinue)
foreach ($s in $starts) {
  $type = 'Start'
  if ($s.Message -match '0x([0-9a-fA-F])') {
    switch ($Matches[1]) { '0' { $type = 'Full restart' } '1' { $type = 'Fast Startup' } '2' { $type = 'Resumed from hibernation' } }
  }
  $in = $logons | Where-Object { $_.TimeCreated -ge $s.TimeCreated -and $_.TimeCreated -le $s.TimeCreated.AddMinutes(10) } | Sort-Object TimeCreated | Select-Object -First 1
  if ($in) { [pscustomobject]@{ at = $s.TimeCreated.ToString('o'); bootMs = [int64](($in.TimeCreated - $s.TimeCreated).TotalMilliseconds); kind = $type } }
}
"#;

fn sorted_rows(rows: Vec<Value>) -> Vec<Value> {
    let mut rows: Vec<Value> = rows.into_iter().filter(|r| r["bootMs"].as_u64().is_some()).collect();
    rows.sort_by(|a, b| a["at"].as_str().cmp(&b["at"].as_str()));
    rows
}

pub fn boots() -> Res<Value> {
    if let Ok(rows) = run_ps_json(WINDOWS_BOOTS, Duration::from_secs(40)) {
        let rows = sorted_rows(rows.into_iter().filter(|r| r["bootMs"].as_u64().unwrap_or(0) > 0).collect());
        if !rows.is_empty() {
            return Ok(json!({ "ok": true, "source": "windows", "boots": rows }));
        }
    }
    match run_ps_json(SYSTEM_STARTS, Duration::from_secs(40)) {
        Ok(rows) if !rows.is_empty() => Ok(json!({ "ok": true, "source": "system", "boots": sorted_rows(rows), "admin": is_admin() })),
        _ => Ok(json!({ "ok": false, "reason": "Windows has not logged any starts that Zyro is allowed to read yet" })),
    }
}

pub fn allow_boot_log() -> Res<Value> {
    let inner = "try { Add-LocalGroupMember -SID S-1-5-32-573 -Member ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -ErrorAction Stop; exit 0 } catch { if ($_.FullyQualifiedErrorId -like '*MemberExists*') { exit 0 } else { exit 1 } }";
    let utf16: Vec<u8> = inner.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    let script = format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{encoded}'; $p.ExitCode"
    );
    match run_ps_timeout(&script, Duration::from_secs(120)) {
        Ok(code) if code.trim() == "0" => {
            ctx().log_add("system", "Let this account read the Windows start-up log (Event Log Readers group)", "none", None);
            Ok(json!({ "ok": true }))
        }
        Ok(_) => Ok(json!({ "ok": false, "reason": "Windows did not allow the change" })),
        Err(_) => Ok(json!({ "ok": false, "reason": "The administrator prompt was cancelled" })),
    }
}

pub fn drives() -> Res<Value> {
    let script = r#"
Get-PhysicalDisk | ForEach-Object {
  $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
  [pscustomobject]@{ name = [string]$_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; health = [string]$_.HealthStatus; size = [int64]$_.Size; temp = $r.Temperature; wear = $r.Wear; hours = $r.PowerOnHours; readErrors = $r.ReadErrorsTotal; writeErrors = $r.WriteErrorsTotal }
}
"#;
    Ok(Value::Array(run_ps_json(script, Duration::from_secs(40))?))
}

pub fn battery() -> Res<Value> {
    let script = r#"
$b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $b) { [pscustomobject]@{ present = $false }; return }
$design = $null; $full = $null; $cycles = $null
$file = Join-Path $env:TEMP ('zyro-battery-' + [guid]::NewGuid().ToString('N') + '.xml')
try {
  powercfg /batteryreport /xml /output $file | Out-Null
  $m = ([xml](Get-Content -LiteralPath $file -Raw)).BatteryReport.Batteries.Battery | Select-Object -First 1
  $design = [int64]$m.DesignCapacity; $full = [int64]$m.FullChargeCapacity; $cycles = [int64]$m.CycleCount
} catch { } finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
[pscustomobject]@{ present = $true; percent = $b.EstimatedChargeRemaining; status = $b.BatteryStatus; design = $design; full = $full; cycles = $cycles }
"#;
    let rows = run_ps_json(script, Duration::from_secs(40))?;
    Ok(rows.into_iter().next().unwrap_or(json!({ "present": false })))
}

pub fn battery_report() -> Res<Value> {
    let dir = documents_dir().join("Zyro Reports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("Battery report.html");
    let path = file.to_string_lossy().to_string();
    run_ps(&format!("powercfg /batteryreport /output '{}' | Out-Null", path.replace('\'', "''")))?;
    let _ = std::process::Command::new("explorer.exe").arg(&path).spawn();
    Ok(json!({ "path": path }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drives_come_back_as_a_list() {
        let v = drives().unwrap();
        assert!(!v.as_array().unwrap().is_empty());
        assert!(v[0]["size"].as_u64().unwrap_or(0) > 0);
    }

    #[test]
    fn battery_present_flag() {
        assert!(battery().unwrap().get("present").is_some());
    }

    #[test]
    fn battery_capacity() {
        let v = battery().unwrap();
        if v["present"] == true {
            let (design, full) = (v["design"].as_u64().unwrap_or(0), v["full"].as_u64().unwrap_or(0));
            assert!(design > 1000 && full > 1000, "{v}");
            assert!(full <= design * 12 / 10);
        }
    }

    #[test]
    fn start_history() {
        let v = boots().unwrap();
        assert_eq!(v["ok"], true, "{v}");
        let rows = v["boots"].as_array().unwrap();
        assert!(!rows.is_empty());
        for r in rows {
            assert!(r["bootMs"].as_u64().unwrap() < 600_000);
            assert!(r["at"].as_str().unwrap().starts_with("20"));
        }
        let times: Vec<&str> = rows.iter().map(|r| r["at"].as_str().unwrap()).collect();
        let mut sorted = times.clone();
        sorted.sort();
        assert_eq!(times, sorted, "oldest first");
    }

    #[test]
    fn rows_without_a_duration_are_dropped() {
        let rows = sorted_rows(vec![json!({ "at": "2026-02-01", "bootMs": 5 }), json!({ "at": "2026-01-01", "bootMs": 7 }), json!({ "at": "2026-03-01" })]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["bootMs"], 7);
    }
}
