use crate::util::now_ms;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UndoEntry {
    pub id: String,
    pub ts: u64,
    pub module: String,
    pub label: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo: Option<Value>,
    #[serde(default)]
    pub reverted: bool,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct UndoLog {
    path: PathBuf,
    entries: Vec<UndoEntry>,
}

impl UndoLog {
    pub fn load(path: PathBuf) -> Self {
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        UndoLog { path, entries }
    }

    fn save(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string_pretty(&self.entries) {
            let _ = std::fs::write(&self.path, s);
        }
    }

    pub fn add(&mut self, module: &str, label: &str, kind: &str, undo: Option<Value>) -> UndoEntry {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let entry = UndoEntry {
            id: format!("{:x}-{:04x}", now_ms(), n),
            ts: now_ms(),
            module: module.into(),
            label: label.into(),
            kind: kind.into(),
            undo,
            reverted: false,
        };
        self.entries.push(entry.clone());
        // cap the log
        if self.entries.len() > 1000 {
            let drop = self.entries.len() - 1000;
            self.entries.drain(0..drop);
        }
        self.save();
        entry
    }

    pub fn list(&self) -> Vec<UndoEntry> {
        self.entries.iter().rev().cloned().collect()
    }

    pub fn get(&self, id: &str) -> Option<UndoEntry> {
        self.entries.iter().find(|e| e.id == id).cloned()
    }

    pub fn mark_reverted(&mut self, id: &str) {
        if let Some(e) = self.entries.iter_mut().find(|e| e.id == id) {
            e.reverted = true;
            self.save();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_lists_persists_and_marks_reverted() {
        let dir = std::env::temp_dir().join(format!("zyro-undo-{}", now_ms()));
        let file = dir.join("undo.json");
        let mut a = UndoLog::load(file.clone());
        let e = a.add("tweaks", "x", "registry", Some(serde_json::json!({"k": 1})));
        assert_eq!(a.list().len(), 1);
        let mut b = UndoLog::load(file.clone());
        assert_eq!(b.list()[0].id, e.id);
        b.mark_reverted(&e.id);
        assert!(UndoLog::load(file).list()[0].reverted);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ids_are_unique() {
        let dir = std::env::temp_dir().join(format!("zyro-undo2-{}", now_ms()));
        let mut a = UndoLog::load(dir.join("u.json"));
        let x = a.add("m", "a", "none", None);
        let y = a.add("m", "b", "none", None);
        assert_ne!(x.id, y.id);
        let _ = std::fs::remove_dir_all(dir);
    }
}
