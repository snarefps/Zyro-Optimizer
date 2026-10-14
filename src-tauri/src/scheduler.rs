use crate::cleaner::{apply_ids, scan_items};
use crate::ctx::{ctx, emit, Schedule};
use crate::model::Res;
use crate::util::{format_bytes, now_ms};
use chrono::{DateTime, Local, TimeZone};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_notification::NotificationExt;

const DAY: u64 = 86_400_000;

fn period_ms(freq: &str) -> u64 {
    match freq {
        "daily" => DAY,
        "monthly" => 30 * DAY,
        _ => 7 * DAY,
    }
}

pub fn is_due(s: &Schedule, now: DateTime<Local>) -> bool {
    if !s.enabled || s.targets.is_empty() {
        return false;
    }
    let mut parts = s.time.split(':');
    let (Some(h), Some(m)) = (parts.next().and_then(|x| x.parse::<u32>().ok()), parts.next().and_then(|x| x.parse::<u32>().ok())) else { return false };
    let Some(today_at) = now.date_naive().and_hms_opt(h, m, 0).and_then(|n| Local.from_local_datetime(&n).earliest()) else { return false };
    if now < today_at {
        return false;
    }
    if s.last_run == 0 {
        return true;
    }
    (today_at.timestamp_millis() as u64).saturating_sub(s.last_run) >= period_ms(&s.frequency).saturating_sub(3_600_000)
}

pub fn get_config() -> Res<Value> {
    let s = ctx().settings();
    Ok(json!({
        "schedule": s.schedule,
        "totalFreedBytes": s.total_freed_bytes,
        "history": s.clean_history,
        "launchAtLogin": s.launch_at_login,
        "minimizeToTray": s.minimize_to_tray
    }))
}

pub fn set_schedule(schedule: Schedule) -> Res<Value> {
    ctx().update_settings(|s| {
        let last = s.schedule.last_run;
        s.schedule = Schedule { last_run: last, ..schedule };
    });
    get_config()
}

static RUNNING: AtomicBool = AtomicBool::new(false);

pub fn notify(body: &str) {
    let _ = ctx().app().notification().builder().title("Zyro Optimizer").body(body).show();
}

pub fn run_now(manual: bool) -> Res<Value> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(json!({ "freed": 0 }));
    }
    let result = (|| {
        let cfg = ctx().settings().schedule;
        let available: Vec<String> = scan_items().into_iter().filter(|i| i.needs_admin != Some(true)).map(|i| i.id).collect();
        let ids: Vec<String> = cfg.targets.iter().filter(|t| available.contains(t)).cloned().collect();
        let freed: u64 = apply_ids(&ids, "Scheduled clean").iter().filter_map(|r| r.freed_bytes).sum();
        ctx().update_settings(|s| s.schedule.last_run = now_ms());
        if !manual {
            notify(&if freed > 0 { format!("Scheduled clean freed {}.", format_bytes(freed)) } else { "Scheduled clean ran. Nothing to remove.".to_string() });
            emit("scheduler:ran", json!({ "freed": freed }));
        }
        json!({ "freed": freed })
    })();
    RUNNING.store(false, Ordering::SeqCst);
    Ok(result)
}

pub fn start() {
    std::thread::Builder::new()
        .name("zyro-scheduler".into())
        .spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let cfg = ctx().settings().schedule;
            if is_due(&cfg, Local::now()) {
                let _ = run_now(false);
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }
    fn ms(t: DateTime<Local>) -> u64 {
        t.timestamp_millis() as u64
    }
    fn base() -> Schedule {
        Schedule { enabled: true, frequency: "daily".into(), time: "12:00".into(), targets: vec!["user-temp".into()], last_run: 0 }
    }

    #[test]
    fn never_due_when_disabled_or_without_targets() {
        assert!(!is_due(&Schedule { enabled: false, ..base() }, at(2026, 10, 12, 13, 0)));
        assert!(!is_due(&Schedule { targets: vec![], ..base() }, at(2026, 10, 12, 13, 0)));
    }

    #[test]
    fn waits_for_the_scheduled_time_of_day() {
        assert!(!is_due(&base(), at(2026, 10, 12, 11, 59)));
        assert!(is_due(&base(), at(2026, 10, 12, 12, 1)));
    }

    #[test]
    fn daily_runs_once_per_day() {
        let ran = Schedule { last_run: ms(at(2026, 10, 12, 12, 2)), ..base() };
        assert!(!is_due(&ran, at(2026, 10, 12, 18, 0)));
        assert!(is_due(&ran, at(2026, 10, 13, 12, 1)));
    }

    #[test]
    fn weekly_and_monthly_are_spaced() {
        let w = Schedule { frequency: "weekly".into(), last_run: ms(at(2026, 10, 5, 12, 5)), ..base() };
        assert!(!is_due(&w, at(2026, 10, 10, 13, 0)));
        assert!(is_due(&w, at(2026, 10, 12, 13, 0)));
        let mo = Schedule { frequency: "monthly".into(), last_run: ms(at(2026, 10, 1, 12, 5)), ..base() };
        assert!(!is_due(&mo, at(2026, 10, 20, 13, 0)));
        assert!(is_due(&mo, at(2026, 10, 31, 13, 0)));
    }

    #[test]
    fn bad_time_strings_are_never_due() {
        assert!(!is_due(&Schedule { time: "nonsense".into(), ..base() }, at(2026, 10, 12, 13, 0)));
    }
}
