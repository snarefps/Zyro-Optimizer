use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Res<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    Safe,
    Low,
    Medium,
    High,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanItem {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    pub risk: Risk,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_admin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

impl ScanItem {
    pub fn new(id: impl Into<String>, label: impl Into<String>, risk: Risk) -> Self {
        ScanItem { id: id.into(), label: label.into(), detail: None, size_bytes: None, risk, needs_admin: None, meta: None }
    }
    pub fn detail(mut self, d: impl Into<String>) -> Self {
        self.detail = Some(d.into());
        self
    }
    pub fn size(mut self, s: u64) -> Self {
        self.size_bytes = Some(s);
        self
    }
    pub fn admin(mut self, a: bool) -> Self {
        self.needs_admin = Some(a);
        self
    }
    pub fn meta(mut self, m: Value) -> Self {
        self.meta = Some(m);
        self
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemResult {
    pub id: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freed_bytes: Option<u64>,
}

impl ItemResult {
    pub fn ok(id: impl Into<String>) -> Self {
        ItemResult { id: id.into(), status: "ok", reason: None, freed_bytes: None }
    }
    pub fn ok_note(id: impl Into<String>, note: impl Into<String>) -> Self {
        ItemResult { id: id.into(), status: "ok", reason: Some(note.into()), freed_bytes: None }
    }
    pub fn skipped(id: impl Into<String>, reason: impl Into<String>) -> Self {
        ItemResult { id: id.into(), status: "skipped", reason: Some(reason.into()), freed_bytes: None }
    }
    pub fn failed(id: impl Into<String>, reason: impl Into<String>) -> Self {
        ItemResult { id: id.into(), status: "failed", reason: Some(reason.into()), freed_bytes: None }
    }
    pub fn freed(mut self, bytes: u64) -> Self {
        self.freed_bytes = Some(bytes);
        self
    }
}

pub fn to_value<T: Serialize>(v: T) -> Res<Value> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
