use crate::ctx::{ctx, is_admin};
use crate::model::Res;
use crate::undo::UndoEntry;
use crate::util::{now_ms, run_exe};
use serde_json::{json, Value};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::{Duration, Instant};

struct Target {
    id: &'static str,
    name: &'static str,
    group: &'static str,
    host: &'static str,
    port: u16,
}

const TARGETS: &[Target] = &[
    Target { id: "google-dns", name: "Google DNS", group: "DNS servers", host: "8.8.8.8", port: 53 },
    Target { id: "cloudflare-dns", name: "Cloudflare DNS", group: "DNS servers", host: "1.1.1.1", port: 53 },
    Target { id: "quad9-dns", name: "Quad9 DNS", group: "DNS servers", host: "9.9.9.9", port: 53 },
    Target { id: "shecan-dns", name: "Shecan DNS", group: "DNS servers", host: "178.22.122.100", port: 53 },
    Target { id: "steam", name: "Steam", group: "Game services", host: "steamcommunity.com", port: 443 },
    Target { id: "epic", name: "Epic Games", group: "Game services", host: "epicgames.com", port: 443 },
    Target { id: "riot", name: "Riot Games", group: "Game services", host: "riotgames.com", port: 443 },
    Target { id: "battlenet", name: "Battle.net", group: "Game services", host: "battle.net", port: 443 },
    Target { id: "xbox", name: "Xbox network", group: "Game services", host: "xbox.com", port: 443 },
    Target { id: "discord", name: "Discord", group: "Apps", host: "discord.com", port: 443 },
    Target { id: "github", name: "GitHub", group: "Apps", host: "github.com", port: 443 },
];

pub fn targets() -> Res<Value> {
    Ok(Value::Array(TARGETS.iter().map(|t| json!({ "id": t.id, "name": t.name, "group": t.group, "host": t.host })).collect()))
}

fn connect_time(t: &Target) -> Option<u64> {
    let addr = (t.host, t.port).to_socket_addrs().ok()?.next()?;
    let start = Instant::now();
    TcpStream::connect_timeout(&addr, Duration::from_millis(2000)).ok()?;
    Some(start.elapsed().as_millis() as u64)
}

pub fn ping(ids: Vec<String>) -> Res<Value> {
    let results: Vec<Value> = std::thread::scope(|s| {
        let handles: Vec<_> = ids
            .iter()
            .filter_map(|id| TARGETS.iter().find(|t| t.id == id))
            .map(|t| s.spawn(move || json!({ "id": t.id, "ms": connect_time(t) })))
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    Ok(Value::Array(results))
}

fn hosts_path() -> PathBuf {
    PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())).join(r"System32\drivers\etc\hosts")
}

fn backups_dir() -> PathBuf {
    ctx().data_dir.join("hosts-backups")
}

pub fn hosts_read() -> Res<Value> {
    let bytes = std::fs::read(hosts_path()).map_err(|e| format!("Could not read the hosts file: {e}"))?;
    Ok(json!({ "path": hosts_path().to_string_lossy(), "text": String::from_utf8_lossy(&bytes), "admin": is_admin() }))
}

fn write_hosts(text: &str) -> Res<()> {
    std::fs::write(hosts_path(), text).map_err(|e| format!("Windows refused to change the hosts file: {e}"))?;
    let _ = run_exe("ipconfig", &["/flushdns"]);
    Ok(())
}

pub fn hosts_write(text: String) -> Res<Value> {
    if !is_admin() {
        return Ok(json!({ "ok": false, "reason": "Needs administrator rights" }));
    }
    if text.len() > 512 * 1024 || text.contains('\0') {
        return Ok(json!({ "ok": false, "reason": "That text is too large or not plain text" }));
    }
    let dir = backups_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let backup = dir.join(format!("hosts-{}.bak", now_ms()));
    std::fs::copy(hosts_path(), &backup).map_err(|e| format!("Could not back up the hosts file first: {e}"))?;
    if let Err(e) = write_hosts(&text) {
        return Ok(json!({ "ok": false, "reason": e }));
    }
    let mut old: Vec<_> = std::fs::read_dir(&dir).map(|r| r.filter_map(|e| e.ok()).map(|e| e.path()).collect()).unwrap_or_default();
    old.sort();
    while old.len() > 10 {
        let _ = std::fs::remove_file(old.remove(0));
    }
    ctx().log_add("hosts", "Edited the hosts file", "hosts", Some(json!({ "backup": backup.to_string_lossy() })));
    Ok(json!({ "ok": true }))
}

pub fn revert_hosts(entry: &UndoEntry) -> Res<()> {
    let backup = entry.undo.as_ref().and_then(|u| u.get("backup")).and_then(|b| b.as_str()).ok_or("Nothing to undo")?;
    let backup = PathBuf::from(backup);
    if backup.parent() != Some(backups_dir().as_path()) {
        return Err("That backup is not one of Zyro's".into());
    }
    let text = std::fs::read(&backup).map_err(|_| "The backup of the hosts file is gone".to_string())?;
    write_hosts(&String::from_utf8_lossy(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_ids_are_unique() {
        let mut ids: Vec<_> = TARGETS.iter().map(|t| t.id).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n);
    }

    #[test]
    fn the_hosts_file_can_be_read() {
        let v = hosts_read().unwrap();
        assert!(v["text"].as_str().unwrap().to_lowercase().contains("localhost") || v["text"].as_str().unwrap().contains('#'));
    }

    #[test]
    fn a_known_target_gets_an_answer_entry() {
        let r = ping(vec!["cloudflare-dns".into()]).unwrap();
        assert_eq!(r[0]["id"], "cloudflare-dns");
    }

    #[test]
    fn unknown_ids_are_ignored() {
        let r = ping(vec!["nope".into()]).unwrap();
        assert_eq!(r.as_array().unwrap().len(), 0);
    }
}
