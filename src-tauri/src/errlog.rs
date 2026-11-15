use crate::ctx::CTX_DIR;
use crate::model::Res;
use crate::util::now_ms;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const KEEP: usize = 200;

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> Option<PathBuf> {
    CTX_DIR.get().map(|d| d.join("errors.log"))
}

pub fn record(source: &str, message: &str) {
    let Some(path) = file() else { return };
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let message: String = message.chars().take(600).collect();
    let line = json!({ "ts": now_ms(), "source": source, "message": message }).to_string();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
    if let Ok(text) = std::fs::read_to_string(&path) {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() > KEEP * 2 {
            let _ = std::fs::write(&path, lines[lines.len() - KEEP..].join("\n") + "\n");
        }
    }
}

pub fn list() -> Res<Value> {
    let Some(path) = file() else { return Ok(json!([])) };
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut rows: Vec<Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    rows.reverse();
    rows.truncate(KEEP);
    Ok(Value::Array(rows))
}

pub fn clear() -> Res<Value> {
    if let Some(path) = file() {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _ = std::fs::remove_file(path);
    }
    Ok(Value::Null)
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record("backend", &info.to_string());
        previous(info);
    }));
}
