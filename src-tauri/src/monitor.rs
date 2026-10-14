use crate::model::Res;
use crate::util::{now_ms, run_ps_json};
use serde_json::{json, Value};
use std::mem::{size_of, zeroed};
use std::sync::Mutex;
use std::time::Duration;
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows_sys::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::GetSystemTimes;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn ft(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

static PREV_CPU: Mutex<Option<(u64, u64)>> = Mutex::new(None);

fn cpu_total() -> u32 {
    let (idle, total) = unsafe {
        let (mut i, mut k, mut u): (FILETIME, FILETIME, FILETIME) = (zeroed(), zeroed(), zeroed());
        if GetSystemTimes(&mut i, &mut k, &mut u) == 0 {
            return 0;
        }
        (ft(i), ft(k) + ft(u))
    };
    let mut prev = PREV_CPU.lock().unwrap_or_else(|e| e.into_inner());
    let pct = match *prev {
        Some((pi, pt)) if total > pt => {
            let dt = (total - pt) as f64;
            let di = idle.saturating_sub(pi) as f64;
            (((dt - di) / dt) * 100.0).round().clamp(0.0, 100.0) as u32
        }
        _ => 0,
    };
    *prev = Some((idle, total));
    pct
}

pub fn memory() -> (u64, u64) {
    unsafe {
        let mut m: MEMORYSTATUSEX = zeroed();
        m.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut m) == 0 {
            return (0, 0);
        }
        (m.ullTotalPhys, m.ullAvailPhys)
    }
}

pub fn disk_space(path: &str) -> Option<(u64, u64)> {
    let w = wide(path);
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, &mut total, &mut free) };
    if ok == 0 { None } else { Some((total, avail)) }
}

static PREV_NET: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

fn adapter_totals() -> Option<(u64, u64)> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table) != 0 || table.is_null() {
            return None;
        }
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let (mut rx, mut tx) = (0u64, 0u64);
        for r in rows {
            let hardware = r.InterfaceAndOperStatusFlags._bitfield & 1 == 1;
            if hardware && (r.Type == 6 || r.Type == 71) && r.OperStatus == 1 {
                rx += r.InOctets;
                tx += r.OutOctets;
            }
        }
        FreeMibTable(table as *const _);
        Some((rx, tx))
    }
}

fn net_rates() -> (f64, f64) {
    let Some((rx, tx)) = adapter_totals() else { return (0.0, 0.0) };
    let at = now_ms();
    let mut prev = PREV_NET.lock().unwrap_or_else(|e| e.into_inner());
    let rates = match *prev {
        Some((prx, ptx, pat)) if at > pat => {
            let secs = (at - pat) as f64 / 1000.0;
            (rx.saturating_sub(prx) as f64 / secs, tx.saturating_sub(ptx) as f64 / secs)
        }
        _ => (0.0, 0.0),
    };
    *prev = Some((rx, tx, at));
    rates
}

pub fn stats() -> Res<Value> {
    let (total, free) = memory();
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let (dt, df) = disk_space(&format!("{system_drive}\\")).unwrap_or((0, 0));
    let (down, up) = net_rates();
    Ok(json!({
        "ts": now_ms(),
        "cpu": { "total": cpu_total(), "cores": [] },
        "mem": { "total": total, "used": total.saturating_sub(free), "free": free },
        "disk": { "total": dt, "used": dt.saturating_sub(df), "free": df },
        "net": { "down": down, "up": up }
    }))
}

static INFO: Mutex<Option<Value>> = Mutex::new(None);

fn read_info() -> Value {
    if let Some(v) = INFO.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return v;
    }
    let script = r#"
$c = Get-CimInstance Win32_Processor | Select-Object -First 1
$g = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
$o = Get-CimInstance Win32_OperatingSystem
$s = Get-CimInstance Win32_ComputerSystem
[pscustomobject]@{ cpuName = [string]$c.Name; cores = [int]$c.NumberOfCores; threads = [int]$c.NumberOfLogicalProcessors; gpu = $g; os = ([string]$o.Caption + ' ' + [string]$o.OSArchitecture); osVersion = [string]$o.Version; machine = ([string]$s.Manufacturer + ' ' + [string]$s.Model) }
"#;
    match run_ps_json(script, Duration::from_secs(30)).ok().and_then(|v| v.into_iter().next()) {
        Some(v) => {
            *INFO.lock().unwrap_or_else(|e| e.into_inner()) = Some(v.clone());
            v
        }
        None => json!({}),
    }
}

pub fn info() -> Res<Value> {
    let mut base = read_info();
    if let Some(o) = base.as_object_mut() {
        o.insert("host".into(), json!(std::env::var("COMPUTERNAME").unwrap_or_default()));
        o.insert("totalMem".into(), json!(memory().0));
        o.insert("uptimeSec".into(), json!(unsafe { GetTickCount64() } / 1000));
        if !o.contains_key("gpu") {
            o.insert("gpu".into(), json!([]));
        }
    }
    Ok(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_adapter_byte_counters_without_spawning_anything() {
        let (rx, tx) = adapter_totals().expect("GetIfTable2 failed");
        println!("rx {rx} tx {tx}");
        assert!(rx > 0 || tx > 0, "no traffic counted on any physical adapter");
        let (rx2, _) = adapter_totals().unwrap();
        assert!(rx2 >= rx);
    }

    #[test]
    fn the_system_drive_reports_space() {
        let (total, free) = disk_space("C:\\").unwrap();
        assert!(total > free && free > 0);
    }

    #[test]
    fn stats_has_every_field_the_dashboard_reads() {
        let v = stats().unwrap();
        for k in ["cpu", "mem", "disk", "net"] {
            assert!(v.get(k).is_some(), "{k}");
        }
    }
}
