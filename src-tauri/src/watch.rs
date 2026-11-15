use crate::ctx::{ctx, emit, PriorityRule, Settings};
use crate::scheduler::notify;
use crate::util::{format_bytes, now_ms};
use crate::{gamebooster, monitor, processes, report, startup};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

const WEEK: u64 = 7 * 86_400_000;

struct Watch {
    game: Option<String>,
    prioritized: HashSet<u32>,
    high_checks: u32,
    last_trim: Option<Instant>,
}

fn check_game(w: &mut Watch, s: &Settings, running: &HashMap<String, Vec<u32>>) {
    let found = s.auto_games.iter().find(|g| running.contains_key(&g.to_lowercase())).cloned();
    match (&w.game, found) {
        (None, Some(game)) if s.auto_boost => {
            if gamebooster::auto_start() {
                notify(&format!("Game Booster is on for {game}"));
                emit("gamebooster:auto", json!({ "active": true, "game": game }));
                w.game = Some(game);
            }
        }
        (Some(_), found) if found.is_none() || !s.auto_boost => {
            gamebooster::auto_stop();
            notify("Game Booster stopped and everything was put back");
            emit("gamebooster:auto", json!({ "active": false }));
            w.game = None;
        }
        _ => {}
    }
}

fn check_priorities(w: &mut Watch, rules: &[PriorityRule], running: &HashMap<String, Vec<u32>>) {
    let live: HashSet<u32> = running.values().flatten().copied().collect();
    w.prioritized.retain(|p| live.contains(p));
    for rule in rules {
        let name = rule.exe.to_lowercase();
        if processes::is_critical(&name) {
            continue;
        }
        for pid in running.get(&name).into_iter().flatten() {
            if w.prioritized.insert(*pid) {
                processes::set_priority(*pid, &rule.level);
            }
        }
    }
}

fn check_trim(w: &mut Watch, s: &Settings) {
    let (total, free) = monitor::memory();
    let used = if total > 0 { total.saturating_sub(free) * 100 / total } else { 0 };
    if used >= s.trim_percent as u64 {
        w.high_checks += 1;
    } else {
        w.high_checks = 0;
    }
    let cooled = w.last_trim.map_or(true, |t| t.elapsed() > Duration::from_secs(600));
    if w.high_checks >= 3 && cooled {
        let (freed, _) = processes::trim_memory_raw();
        w.last_trim = Some(Instant::now());
        w.high_checks = 0;
        if freed > 0 {
            notify(&format!("Memory was above {}%. Zyro freed {} of RAM", s.trim_percent, format_bytes(freed)));
        }
    }
}

fn check_startup(s: &Settings) {
    if !s.startup_alerts && !s.weekly_report {
        return;
    }
    let current = startup::light_items();
    if !s.startup_baselined {
        ctx().update_settings(|c| {
            c.startup_baselined = true;
            c.known_startup = current.iter().map(|e| e.id.clone()).collect();
        });
        return;
    }
    let known: HashSet<&String> = s.known_startup.iter().collect();
    let fresh: Vec<_> = current.iter().filter(|e| !known.contains(&e.id)).collect();
    if fresh.is_empty() {
        return;
    }
    ctx().update_settings(|c| {
        c.known_startup.extend(fresh.iter().map(|e| e.id.clone()));
        c.new_startup_week += fresh.len() as u32;
    });
    if s.startup_alerts {
        let names: Vec<&str> = fresh.iter().map(|e| e.name.as_str()).collect();
        notify(&format!("A program added itself to startup: {}", names.join(", ")));
        emit("startup:new", json!(fresh.iter().map(|e| json!({ "id": e.id, "name": e.name, "cmd": e.cmd })).collect::<Vec<_>>()));
    }
}

fn check_report(s: &Settings) {
    if s.weekly_report && s.last_report > 0 && now_ms().saturating_sub(s.last_report) >= WEEK {
        report::weekly();
    }
}

pub fn start() {
    std::thread::Builder::new()
        .name("zyro-watch".into())
        .spawn(|| {
            let mut w = Watch { game: None, prioritized: HashSet::new(), high_checks: 0, last_trim: None };
            let mut tick: u64 = 0;
            loop {
                std::thread::sleep(Duration::from_secs(4));
                tick += 1;
                let s = ctx().settings();
                let needs_processes = (s.auto_boost && !s.auto_games.is_empty()) || w.game.is_some() || !s.priority_rules.is_empty();
                if needs_processes {
                    let running = processes::running();
                    check_game(&mut w, &s, &running);
                    check_priorities(&mut w, &s.priority_rules, &running);
                }
                if tick % 8 == 0 && s.auto_trim {
                    check_trim(&mut w, &s);
                }
                if tick % 15 == 0 {
                    check_startup(&s);
                    check_report(&s);
                }
            }
        })
        .ok();
}
