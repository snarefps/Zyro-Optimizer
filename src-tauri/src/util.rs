use crate::model::Res;
use base64::Engine;
use serde_json::Value;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn run_exe_timeout(file: &str, args: &[&str], timeout: Duration) -> Res<String> {
    let (ok, stdout, stderr) = run_raw(file, args, timeout)?;
    if ok {
        Ok(stdout)
    } else {
        let msg = if stderr.trim().is_empty() { stdout } else { stderr };
        Err(msg.trim().chars().take(800).collect())
    }
}

pub fn run_raw(file: &str, args: &[&str], timeout: Duration) -> Res<(bool, String, String)> {
    let mut child = Command::new(file)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{file}: {e}"))?;
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let t_out = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b);
        b
    });
    let t_err = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = err.read_to_end(&mut b);
        b
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("{file} timed out"));
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let stdout = String::from_utf8_lossy(&t_out.join().unwrap_or_default()).to_string();
    let stderr = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).to_string();
    Ok((status.success(), stdout, stderr))
}

pub fn run_exe(file: &str, args: &[&str]) -> Res<String> {
    run_exe_timeout(file, args, Duration::from_secs(60))
}

const PRELUDE: &str = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;";

pub fn run_ps_timeout(script: &str, timeout: Duration) -> Res<String> {
    let full = format!("{PRELUDE}{script}");
    let utf16: Vec<u8> = full.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    run_exe_timeout(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded],
        timeout,
    )
}

pub fn run_ps(script: &str) -> Res<String> {
    run_ps_timeout(script, Duration::from_secs(120))
}

pub fn run_ps_json(script: &str, timeout: Duration) -> Res<Vec<Value>> {
    let wrapped = format!(
        "$r = & {{ {script} }}; if ($null -eq $r) {{ '[]' }} else {{ ConvertTo-Json -InputObject @($r) -Compress -Depth 4 }}"
    );
    let out = run_ps_timeout(&wrapped, timeout)?;
    let t = out.trim();
    if t.is_empty() {
        return Ok(vec![]);
    }
    match serde_json::from_str::<Value>(t).map_err(|e| format!("bad JSON from PowerShell: {e}"))? {
        Value::Array(a) => Ok(a),
        v => Ok(vec![v]),
    }
}

pub fn ps_arg(data: &Value) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(data.to_string());
    format!("$a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{b64}')) | ConvertFrom-Json;")
}

pub fn format_bytes(n: u64) -> String {
    if n < 1024 {
        return format!("{n} B");
    }
    let units = ["KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    loop {
        v /= 1024.0;
        if v < 1024.0 || i == units.len() - 1 {
            break;
        }
        i += 1;
    }
    let s = if v >= 100.0 { format!("{v:.0}") } else if v >= 10.0 { format!("{v:.1}") } else { format!("{v:.2}") };
    format!("{s} {}", units[i])
}

pub fn str_field(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_sizes() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1536), "1.50 KB");
        assert_eq!(format_bytes(5 * 1024 * 1024 * 1024), "5.00 GB");
    }

    #[test]
    fn powershell_roundtrips_awkward_data() {
        let data = serde_json::json!({ "name": "it's \"quoted\" $x `tick" });
        let out = run_ps(&format!("{} $a.name", ps_arg(&data))).unwrap();
        assert_eq!(out.trim(), "it's \"quoted\" $x `tick");
    }

    #[test]
    fn run_exe_reports_failure() {
        assert!(run_exe("cmd", &["/c", "exit", "3"]).is_err());
        assert_eq!(run_exe("cmd", &["/c", "echo", "hi"]).unwrap().trim(), "hi");
    }
}
