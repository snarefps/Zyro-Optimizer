use crate::model::{to_value, Res};
use crate::monitor::memory;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows_sys::Win32::System::ProcessStatus::K32EmptyWorkingSet;
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA};
use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};

pub const CRITICAL: &[&str] = &[
    "system", "idle", "registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "svchost", "dwm", "explorer", "fontdrvhost",
    "memory compression", "secure system", "sihost", "taskhostw", "runtimebroker", "audiodg", "wmiprvse", "msmpeng", "nissrv",
    "securityhealthservice", "ctfmon", "conhost", "searchhost", "startmenuexperiencehost", "shellexperiencehost", "textinputhost", "lockapp",
    "logonui", "spoolsv", "zyro-optimizer", "zyro optimizer",
];

pub fn is_critical(name: &str) -> bool {
    let n = name.to_lowercase();
    CRITICAL.contains(&n.as_str())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub mem_bytes: u64,
    pub cpu_pct: f32,
    pub path: Option<String>,
    pub title: String,
    pub has_window: bool,
    pub protected: bool,
}

static SYS: Mutex<Option<System>> = Mutex::new(None);

unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let map = &mut *(lparam as *mut HashMap<u32, String>);
    if IsWindowVisible(hwnd) != 0 {
        let len = GetWindowTextLengthW(hwnd);
        if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            map.entry(pid).or_insert_with(|| String::from_utf16_lossy(&buf[..n.max(0) as usize]));
        }
    }
    1
}

pub fn window_titles() -> HashMap<u32, String> {
    let mut map: HashMap<u32, String> = HashMap::new();
    unsafe {
        EnumWindows(Some(enum_cb), &mut map as *mut _ as LPARAM);
    }
    map
}

fn refresh(sys: &mut System) {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory().with_cpu().with_exe(UpdateKind::OnlyIfNotSet),
    );
}

fn clean_name(n: &str) -> String {
    n.strip_suffix(".exe").or_else(|| n.strip_suffix(".EXE")).unwrap_or(n).to_string()
}

fn is_ours(sys: &System, mut pid: u32) -> bool {
    let me = std::process::id();
    for _ in 0..8 {
        if pid == me {
            return true;
        }
        match sys.process(Pid::from_u32(pid)).and_then(|p| p.parent()) {
            Some(parent) => pid = parent.as_u32(),
            None => return false,
        }
    }
    false
}

pub fn snapshot() -> Vec<ProcInfo> {
    let titles = window_titles();
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
    let mut guard = SYS.lock().unwrap_or_else(|e| e.into_inner());
    let sys = guard.get_or_insert_with(System::new);
    refresh(sys);
    let sys = &*sys;
    let mut out: Vec<ProcInfo> = sys
        .processes()
        .values()
        .map(|p| {
            let pid = p.pid().as_u32();
            let name = clean_name(&p.name().to_string_lossy());
            let title = titles.get(&pid).cloned().unwrap_or_default();
            ProcInfo {
                pid,
                protected: is_critical(&name) || is_ours(sys, pid),
                name,
                mem_bytes: p.memory(),
                cpu_pct: (p.cpu_usage() / cores * 10.0).round() / 10.0,
                path: p.exe().map(|e| e.to_string_lossy().to_string()),
                has_window: !title.is_empty(),
                title,
            }
        })
        .collect();
    out.sort_by(|a, b| b.mem_bytes.cmp(&a.mem_bytes));
    out
}

pub fn list() -> Res<Value> {
    to_value(snapshot())
}

pub fn kill(pid: u32) -> Res<Value> {
    let mut guard = SYS.lock().unwrap_or_else(|e| e.into_inner());
    let sys = guard.get_or_insert_with(System::new);
    refresh(sys);
    let Some(p) = sys.process(sysinfo::Pid::from_u32(pid)) else {
        return Ok(json!({ "ok": false, "reason": "Process no longer exists" }));
    };
    let name = clean_name(&p.name().to_string_lossy());
    if is_critical(&name) {
        return Ok(json!({ "ok": false, "reason": format!("{name} is a protected system process") }));
    }
    if is_ours(sys, pid) {
        return Ok(json!({ "ok": false, "reason": "Cannot close Zyro itself" }));
    }
    Ok(if p.kill() { json!({ "ok": true }) } else { json!({ "ok": false, "reason": "Access denied. Try running Zyro as administrator." }) })
}

pub fn trim_memory_raw() -> (u64, u32) {
    let before = memory().1;
    let pids: Vec<u32> = {
        let mut guard = SYS.lock().unwrap_or_else(|e| e.into_inner());
        let sys = guard.get_or_insert_with(System::new);
        refresh(sys);
        sys.processes().keys().map(|p| p.as_u32()).collect()
    };
    let mut trimmed = 0u32;
    for pid in pids {
        unsafe {
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, 0, pid);
            if !h.is_null() {
                if K32EmptyWorkingSet(h) != 0 {
                    trimmed += 1;
                }
                CloseHandle(h);
            }
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(800));
    (memory().1.saturating_sub(before), trimmed)
}

pub fn trim_memory() -> Res<Value> {
    let (freed, n) = trim_memory_raw();
    Ok(json!({ "freedBytes": freed, "processes": n }))
}
