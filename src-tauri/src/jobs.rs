use crate::model::Res;
use crate::util::now_ms;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

const VALID_FOR_MS: u64 = 120_000;

static REQUESTED_AT: AtomicU64 = AtomicU64::new(0);

fn active(at: u64, now: u64) -> bool {
    at != 0 && now.saturating_sub(at) < VALID_FOR_MS
}

pub fn requested() -> bool {
    active(REQUESTED_AT.load(Ordering::Relaxed), now_ms())
}

pub fn cancel() -> Res<Value> {
    REQUESTED_AT.store(now_ms(), Ordering::Relaxed);
    Ok(Value::Null)
}

pub fn reset() -> Res<Value> {
    REQUESTED_AT.store(0, Ordering::Relaxed);
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_window() {
        assert!(!active(0, 1_000_000));
        assert!(active(1_000_000, 1_060_000));
        assert!(!active(1_000_000, 1_000_000 + VALID_FOR_MS));
    }
}
