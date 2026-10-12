use crate::model::Res;
use crate::util::{now_ms, run_exe_timeout, run_ps_json};
use regex::Regex;
use serde_json::{json, Value};
use std::mem::{size_of, zeroed};
use std::sync::{Mutex, OnceLock};
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
        (ft(i), ft(k) + ft(u)) // kernel time already includes idle time
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

fn net_rates() -> (f64, f64) {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)Bytes\s+(\d+)\s+(\d+)").unwrap());
    let Ok(out) = run_exe_timeout("netstat", &["-e"], Duration::from_secs(5)) else { return (0.0, 0.0) };
    let Some(c) = re.captures(&out) else { return (0.0, 0.0) };
    let (rx, tx, at) = (c[1].parse::<u64>().unwrap_or(0), c[2].parse::<u64>().unwrap_or(0), now_ms());
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
    let (dt, df) = disk_space("C:\\").unwrap_or((0, 0));
    let (down, up) = net_rates();
    Ok(json!({
        "ts": now_ms(),
        "cpu": { "total": cpu_total(), "cores": [] },
        "mem": { "total": total, "used": total.saturating_sub(free), "free": free },
        "disk": { "total": dt, "used": dt.saturating_sub(df), "free": df },
        "net": { "down": down, "up": up }
    }))
}

static INFO: OnceLock<Value> = OnceLock::new();

pub fn info() -> Res<Value> {
    let mut base = INFO
        .get_or_init(|| {
            let script = r#"
$c = Get-CimInstance Win32_Processor | Select-Object -First 1
$g = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
$o = Get-CimInstance Win32_OperatingSystem
$s = Get-CimInstance Win32_ComputerSystem
[pscustomobject]@{ cpuName = [string]$c.Name; cores = [int]$c.NumberOfCores; threads = [int]$c.NumberOfLogicalProcessors; gpu = $g; os = ([string]$o.Caption + ' ' + [string]$o.OSArchitecture); osVersion = [string]$o.Version; machine = ([string]$s.Manufacturer + ' ' + [string]$s.Model) }
"#;
            run_ps_json(script, Duration::from_secs(30)).ok().and_then(|v| v.into_iter().next()).unwrap_or_else(|| json!({}))
        })
        .clone();
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
