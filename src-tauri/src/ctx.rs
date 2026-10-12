use crate::undo::{UndoEntry, UndoLog};
use crate::util::{now_ms, run_exe};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub ts: u64,
    pub freed: u64,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub enabled: bool,
    pub frequency: String,
    pub time: String,
    pub targets: Vec<String>,
    pub last_run: u64,
}

impl Default for Schedule {
    fn default() -> Self {
        Schedule { enabled: false, frequency: "weekly".into(), time: "12:00".into(), targets: vec![], last_run: 0 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub total_freed_bytes: u64,
    pub clean_history: Vec<HistoryPoint>,
    pub schedule: Schedule,
    pub launch_at_login: bool,
    pub minimize_to_tray: bool,
    pub last_restore_point: u64,
    pub auto_restore_point: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            total_freed_bytes: 0,
            clean_history: vec![],
            schedule: Schedule::default(),
            launch_at_login: false,
            minimize_to_tray: true,
            last_restore_point: 0,
            auto_restore_point: true,
        }
    }
}

pub struct Ctx {
    pub data_dir: PathBuf,
    undo: Mutex<UndoLog>,
    settings: Mutex<Settings>,
    app: AppHandle,
}

static CTX: OnceLock<Ctx> = OnceLock::new();

pub fn init(app: AppHandle, data_dir: PathBuf) {
    let _ = std::fs::create_dir_all(&data_dir);
    let settings: Settings = std::fs::read_to_string(data_dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let _ = CTX.set(Ctx {
        undo: Mutex::new(UndoLog::load(data_dir.join("undo-log.json"))),
        settings: Mutex::new(settings),
        data_dir,
        app,
    });
}

pub fn ctx() -> &'static Ctx {
    CTX.get().expect("context not initialised")
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Ctx {
    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    pub fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    pub fn update_settings<R>(&self, f: impl FnOnce(&mut Settings) -> R) -> R {
        let mut s = lock(&self.settings);
        let r = f(&mut s);
        if let Ok(text) = serde_json::to_string_pretty(&*s) {
            let _ = std::fs::write(self.data_dir.join("settings.json"), text);
        }
        r
    }

    pub fn log_add(&self, module: &str, label: &str, kind: &str, undo: Option<Value>) -> UndoEntry {
        lock(&self.undo).add(module, label, kind, undo)
    }
    pub fn log_list(&self) -> Vec<UndoEntry> {
        lock(&self.undo).list()
    }
    pub fn log_get(&self, id: &str) -> Option<UndoEntry> {
        lock(&self.undo).get(id)
    }
    pub fn log_mark_reverted(&self, id: &str) {
        lock(&self.undo).mark_reverted(id)
    }

    pub fn record_freed(&self, bytes: u64, source: &str) {
        if bytes == 0 {
            return;
        }
        self.update_settings(|s| {
            s.total_freed_bytes += bytes;
            s.clean_history.push(HistoryPoint { ts: now_ms(), freed: bytes, source: source.into() });
            if s.clean_history.len() > 100 {
                let drop = s.clean_history.len() - 100;
                s.clean_history.drain(0..drop);
            }
        });
    }
}

pub fn emit(channel: &str, payload: Value) {
    if let Some(c) = CTX.get() {
        let _ = c.app.emit(channel, payload);
    }
}

pub fn minimize_to_tray() -> bool {
    CTX.get().map(|c| c.settings().minimize_to_tray).unwrap_or(true)
}

static ADMIN: OnceLock<bool> = OnceLock::new();
pub fn is_admin() -> bool {
    *ADMIN.get_or_init(|| run_exe("net", &["session"]).is_ok())
}
