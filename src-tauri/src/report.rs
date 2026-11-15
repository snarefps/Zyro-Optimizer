use crate::ctx::{ctx, is_admin};
use crate::model::Res;
use crate::scheduler::notify;
use crate::util::{documents_dir, format_bytes, now_ms};
use chrono::Local;
use serde_json::{json, Value};
use std::path::PathBuf;

const DAY: u64 = 86_400_000;

fn reports_dir() -> PathBuf {
    documents_dir().join("Zyro Reports")
}

fn text(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("unknown").to_string()
}

fn num(v: &Value, k: &str) -> u64 {
    v.get(k).and_then(|x| x.as_u64()).unwrap_or(0)
}

fn junk_total() -> u64 {
    crate::cleaner::scan_items().iter().map(|i| i.size_bytes.unwrap_or(0)).sum()
}

fn uptime(sec: u64) -> String {
    format!("{}d {}h {}m", sec / 86400, sec % 86400 / 3600, sec % 3600 / 60)
}

pub fn build() -> Res<String> {
    let info = crate::monitor::info()?;
    let stats = crate::monitor::stats()?;
    let drives = crate::disk::drives()?;
    let mem = &stats["mem"];
    let mem_total = num(mem, "total").max(1);
    let gpus: Vec<String> = info["gpu"].as_array().map(|a| a.iter().filter_map(|g| g.as_str().map(String::from)).collect()).unwrap_or_default();
    let s = ctx().settings();
    let mut out = String::new();
    out.push_str(&format!("Zyro Optimizer report, {}\n", Local::now().format("%Y-%m-%d %H:%M")));
    out.push_str(&format!("Zyro version {}, administrator rights: {}\n\n", env!("CARGO_PKG_VERSION"), if is_admin() { "yes" } else { "no" }));
    out.push_str("Computer\n");
    out.push_str(&format!("  Name       {}\n", text(&info, "host")));
    out.push_str(&format!("  Model      {}\n", text(&info, "machine")));
    out.push_str(&format!("  Windows    {}\n", text(&info, "os")));
    out.push_str(&format!("  Processor  {} ({} cores, {} threads)\n", text(&info, "cpuName"), num(&info, "cores"), num(&info, "threads")));
    out.push_str(&format!("  Graphics   {}\n", if gpus.is_empty() { "unknown".to_string() } else { gpus.join(", ") }));
    out.push_str(&format!("  Memory     {}\n", format_bytes(num(&info, "totalMem"))));
    out.push_str(&format!("  Uptime     {}\n\n", uptime(num(&info, "uptimeSec"))));
    out.push_str("Drives\n");
    for d in drives.as_array().cloned().unwrap_or_default() {
        let (total, free) = (num(&d, "total"), num(&d, "free"));
        let used = if total > 0 { (total - free) * 100 / total } else { 0 };
        out.push_str(&format!("  {}:  {} free of {} ({used}% used)\n", text(&d, "letter"), format_bytes(free), format_bytes(total)));
    }
    out.push_str("\nRight now\n");
    out.push_str(&format!("  Processor use  {}%\n", stats["cpu"]["total"].as_u64().unwrap_or(0)));
    out.push_str(&format!("  Memory use     {}% ({} of {})\n", num(mem, "used") * 100 / mem_total, format_bytes(num(mem, "used")), format_bytes(mem_total)));
    out.push_str(&format!("  Startup items  {}\n", crate::startup::light_items().len()));
    out.push_str(&format!("  Junk files     {}\n", format_bytes(junk_total())));
    out.push_str(&format!("  Freed by Zyro  {}\n", format_bytes(s.total_freed_bytes)));
    Ok(out)
}

fn write(name: String, body: &str) -> Res<String> {
    let dir = reports_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn save() -> Res<Value> {
    let body = build()?;
    let path = write(format!("Zyro report {}.txt", Local::now().format("%Y-%m-%d %H%M")), &body)?;
    ctx().log_add("system", "Saved a PC report", "none", None);
    Ok(json!({ "path": path }))
}

pub fn weekly() {
    let s = ctx().settings();
    let since = now_ms().saturating_sub(7 * DAY);
    let freed: u64 = s.clean_history.iter().filter(|h| h.ts >= since).map(|h| h.freed).sum();
    let runs = s.clean_history.iter().filter(|h| h.ts >= since).count();
    let junk = junk_total();
    let body = format!(
        "Zyro Optimizer weekly summary, {}\n\nFreed this week      {} in {} clean(s)\nNew startup items    {}\nJunk found right now {}\nFreed in total       {}\n",
        Local::now().format("%Y-%m-%d"),
        format_bytes(freed),
        runs,
        s.new_startup_week,
        format_bytes(junk),
        format_bytes(s.total_freed_bytes)
    );
    let _ = write(format!("Zyro weekly summary {}.txt", Local::now().format("%Y-%m-%d")), &body);
    ctx().update_settings(|s| {
        s.last_report = now_ms();
        s.new_startup_week = 0;
    });
    notify(&format!("This week: freed {}, {} new startup item(s). {} of junk is waiting", format_bytes(freed), s.new_startup_week, format_bytes(junk)));
}
