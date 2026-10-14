use crate::ctx::{ctx, is_admin};
use crate::model::Res;
use crate::undo::UndoEntry;
use crate::util::{ps_arg, run_ps, run_ps_json, str_field};
use serde_json::{json, Value};
use std::net::{Ipv4Addr, UdpSocket};
use std::time::{Duration, Instant};

struct Preset {
    id: &'static str,
    name: &'static str,
    group: &'static str,
    servers: [&'static str; 2],
    gaming: bool,
    note: &'static str,
}

const PRESETS: &[Preset] = &[
    Preset { id: "google", name: "Google", group: "Global", servers: ["8.8.8.8", "8.8.4.4"], gaming: false, note: "Fast and reliable everywhere" },
    Preset { id: "cloudflare", name: "Cloudflare", group: "Global", servers: ["1.1.1.1", "1.0.0.1"], gaming: false, note: "Privacy focused and very low latency" },
    Preset { id: "shecan", name: "Shecan", group: "Iran", servers: ["178.22.122.100", "185.51.200.2"], gaming: false, note: "Free anti-sanction DNS for Iranian users" },
    Preset { id: "radar", name: "Radar Game", group: "Iran, for games", servers: ["10.202.10.10", "10.202.10.11"], gaming: true, note: "Aimed at game services. Private range, so it normally only answers on Iranian networks" },
    Preset { id: "electro", name: "Electro", group: "Iran, for games", servers: ["78.157.42.100", "78.157.42.101"], gaming: true, note: "Popular for game and developer services" },
    Preset { id: "403", name: "403", group: "Iran, for games", servers: ["10.202.10.202", "10.202.10.102"], gaming: true, note: "Aimed at developer tools. Private range, so it normally only answers on Iranian networks" },
    Preset { id: "begzar", name: "Begzar", group: "Iran, for games", servers: ["185.55.226.26", "185.55.225.25"], gaming: true, note: "Free anti-sanction DNS" },
];

fn parse_server(s: &str) -> Res<Ipv4Addr> {
    let ip: Ipv4Addr = s.trim().parse().map_err(|_| format!("\"{s}\" is not a valid IPv4 address"))?;
    if ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() || ip.is_loopback() {
        return Err(format!("{ip} can not be used as a DNS server"));
    }
    Ok(ip)
}

struct Adapter {
    name: String,
    description: String,
    dns: Vec<String>,
    is_static: bool,
    gateway: bool,
}

fn adapters() -> Res<Vec<Adapter>> {
    let script = r#"
Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface } | ForEach-Object {
  $i = $_
  $dns = @((Get-DnsClientServerAddress -InterfaceIndex $i.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
  $reg = (Get-ItemProperty -Path ('HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $i.InterfaceGuid) -ErrorAction SilentlyContinue).NameServer
  $gw = [bool](Get-NetRoute -InterfaceIndex $i.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
  [pscustomobject]@{ name = $i.Name; description = $i.InterfaceDescription; dns = $dns; isStatic = [bool]$reg; gateway = $gw }
}
"#;
    let rows = run_ps_json(script, Duration::from_secs(40))?;
    Ok(rows
        .iter()
        .map(|r| Adapter {
            name: str_field(r, "name"),
            description: str_field(r, "description"),
            dns: match r.get("dns") {
                Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                Some(Value::String(s)) => vec![s.clone()],
                _ => vec![],
            },
            is_static: r.get("isStatic").and_then(|v| v.as_bool()).unwrap_or(false),
            gateway: r.get("gateway").and_then(|v| v.as_bool()).unwrap_or(false),
        })
        .collect())
}

pub fn list() -> Res<Value> {
    let found = adapters()?;
    let presets: Vec<Value> = PRESETS
        .iter()
        .map(|p| json!({ "id": p.id, "name": p.name, "group": p.group, "servers": p.servers, "gaming": p.gaming, "note": p.note }))
        .collect();
    let list: Vec<Value> = found
        .iter()
        .map(|a| json!({ "name": a.name, "description": a.description, "dns": a.dns, "isStatic": a.is_static, "gateway": a.gateway }))
        .collect();
    Ok(json!({ "admin": is_admin(), "adapters": list, "presets": presets }))
}

fn set_servers(adapter: &str, servers: &[String]) -> Res<()> {
    let script = format!(
        "{}Set-DnsClientServerAddress -InterfaceAlias $a.name -ServerAddresses @($a.servers) -ErrorAction Stop; Clear-DnsClientCache",
        ps_arg(&json!({ "name": adapter, "servers": servers }))
    );
    run_ps(&script).map(|_| ())
}

fn reset_servers(adapter: &str) -> Res<()> {
    let script = format!(
        "{}Set-DnsClientServerAddress -InterfaceAlias $a.name -ResetServerAddresses -ErrorAction Stop; Clear-DnsClientCache",
        ps_arg(&json!({ "name": adapter }))
    );
    run_ps(&script).map(|_| ())
}

fn first_line(e: &str) -> String {
    e.lines().find(|l| !l.trim().is_empty()).unwrap_or("Failed").trim().chars().take(200).collect()
}

fn remember(adapter: &Adapter, label: &str) {
    ctx().log_add("dns", label, "dns", Some(json!({ "adapter": adapter.name, "old": adapter.dns, "wasStatic": adapter.is_static })));
}

pub fn apply(adapter: String, primary: String, secondary: String) -> Res<Value> {
    if !is_admin() {
        return Ok(json!({ "ok": false, "reason": "Needs administrator rights" }));
    }
    let mut servers = vec![parse_server(&primary)?.to_string()];
    if !secondary.trim().is_empty() {
        servers.push(parse_server(&secondary)?.to_string());
    }
    let Some(current) = adapters()?.into_iter().find(|a| a.name == adapter) else {
        return Ok(json!({ "ok": false, "reason": "That network adapter is no longer available" }));
    };
    Ok(match set_servers(&adapter, &servers) {
        Ok(()) => {
            remember(&current, &format!("DNS on {adapter} set to {}", servers.join(", ")));
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "reason": first_line(&e) }),
    })
}

pub fn reset(adapter: String) -> Res<Value> {
    if !is_admin() {
        return Ok(json!({ "ok": false, "reason": "Needs administrator rights" }));
    }
    let Some(current) = adapters()?.into_iter().find(|a| a.name == adapter) else {
        return Ok(json!({ "ok": false, "reason": "That network adapter is no longer available" }));
    };
    Ok(match reset_servers(&adapter) {
        Ok(()) => {
            remember(&current, &format!("DNS on {adapter} set back to automatic"));
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "reason": first_line(&e) }),
    })
}

pub fn revert(entry: &UndoEntry) -> Res<()> {
    let u = entry.undo.clone().ok_or("Nothing to undo")?;
    let adapter = str_field(&u, "adapter");
    let was_static = u.get("wasStatic").and_then(|v| v.as_bool()).unwrap_or(false);
    let old: Vec<String> = u.get("old").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
    if was_static && !old.is_empty() {
        set_servers(&adapter, &old)
    } else {
        reset_servers(&adapter)
    }
}

fn query_packet() -> Vec<u8> {
    let mut p = vec![0x5a, 0x59, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
    for part in ["example", "com"] {
        p.push(part.len() as u8);
        p.extend(part.bytes());
    }
    p.extend([0, 0, 1, 0, 1]);
    p
}

fn latency_ms(ip: Ipv4Addr) -> Option<u32> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(Duration::from_millis(1200))).ok()?;
    sock.connect((ip, 53)).ok()?;
    let mut best: Option<u32> = None;
    for _ in 0..2 {
        let started = Instant::now();
        if sock.send(&query_packet()).is_err() {
            continue;
        }
        let mut buf = [0u8; 512];
        if let Ok(n) = sock.recv(&mut buf) {
            if n >= 12 && buf[0] == 0x5a && buf[1] == 0x59 && buf[2] & 0x80 != 0 {
                let ms = started.elapsed().as_millis() as u32;
                best = Some(best.map_or(ms, |b| b.min(ms)));
            }
        }
    }
    best
}

pub fn ping(servers: Vec<String>) -> Res<Value> {
    let ips: Vec<Ipv4Addr> = servers.iter().take(24).filter_map(|s| s.trim().parse().ok()).collect();
    let jobs: Vec<_> = ips.into_iter().map(|ip| std::thread::spawn(move || (ip, latency_ms(ip)))).collect();
    let out: Vec<Value> = jobs
        .into_iter()
        .filter_map(|j| j.join().ok())
        .map(|(ip, ms)| json!({ "server": ip.to_string(), "ms": ms }))
        .collect();
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn presets_are_valid_and_unique() {
        let mut ids = HashSet::new();
        for p in PRESETS {
            assert!(ids.insert(p.id), "duplicate id {}", p.id);
            for s in p.servers {
                parse_server(s).unwrap_or_else(|e| panic!("{}: {e}", p.name));
            }
            assert_ne!(p.servers[0], p.servers[1]);
        }
        for want in ["google", "cloudflare", "shecan"] {
            assert!(ids.contains(want));
        }
    }

    #[test]
    fn rejects_addresses_that_cannot_be_dns_servers() {
        for bad in ["", "abc", "1.2.3", "0.0.0.0", "127.0.0.1", "255.255.255.255", "8.8.8.8; calc", "999.1.1.1"] {
            assert!(parse_server(bad).is_err(), "{bad}");
        }
        assert_eq!(parse_server(" 8.8.4.4 ").unwrap().to_string(), "8.8.4.4");
    }

    #[test]
    fn query_packet_is_a_well_formed_a_question() {
        let p = query_packet();
        assert_eq!(&p[4..6], &[0, 1]);
        assert_eq!(p[12], 7);
        assert_eq!(&p[13..20], b"example");
        assert_eq!(&p[p.len() - 4..], &[0, 1, 0, 1]);
    }

    #[test]
    #[ignore]
    fn times_a_real_resolver() {
        let ms = latency_ms("1.1.1.1".parse().unwrap()).or_else(|| latency_ms("8.8.8.8".parse().unwrap()));
        println!("resolver answered in {ms:?} ms");
        assert!(ms.is_some());
    }

    #[test]
    fn lists_real_adapters() {
        let list = adapters().expect("could not read adapters");
        for a in &list {
            assert!(!a.name.is_empty());
        }
    }
}
