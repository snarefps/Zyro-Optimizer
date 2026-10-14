use crate::ctx::ctx;
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::undo::UndoEntry;
use crate::util::{run_ps_json, run_raw, str_field};
use crate::winget::{self, Applied, Outcome, Winget};
use chrono::NaiveDate;
use regex::Regex;
use serde_json::{json, Value};
use std::process::Command;
use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
pub struct WingetUpgrade {
    pub name: String,
    pub id: String,
    pub version: String,
    pub available: String,
    pub source: String,
}

pub fn parse_winget_upgrade(text: &str) -> Vec<WingetUpgrade> {
    let lines: Vec<&str> = text.lines().map(|l| l.trim_end_matches('\r')).collect();
    let Some(h) = lines.iter().position(|l| l.contains("Name") && l.contains("Id") && l.contains("Version") && l.contains("Available")) else {
        return vec![];
    };
    let header = lines[h];
    let col = |s: &str| header.find(s);
    let (Some(id), Some(version), Some(available)) = (col("Id"), col("Version"), col("Available")) else { return vec![] };
    let source = col("Source");
    let stop = Regex::new(r"(?i)upgrades? available|no installed package|following packages").unwrap();
    let chars = |l: &str| l.chars().collect::<Vec<char>>();
    let slice = |c: &[char], a: usize, b: usize| -> String { c.iter().skip(a).take(b.saturating_sub(a)).collect::<String>().trim().to_string() };
    let hc = chars(header);
    let to_ci = |byte_idx: usize| header[..byte_idx].chars().count();
    let (id, version, available) = (to_ci(id), to_ci(version), to_ci(available));
    let source = source.map(to_ci);
    let _ = hc;
    let mut out = vec![];
    for line in &lines[h + 1..] {
        let t = line.trim();
        if t.is_empty() || t.chars().all(|c| c == '-') {
            continue;
        }
        if stop.is_match(line) {
            break;
        }
        let c = chars(line);
        if c.len() <= available {
            continue;
        }
        let end = source.unwrap_or(c.len());
        let row = WingetUpgrade {
            name: slice(&c, 0, id),
            id: slice(&c, id, version),
            version: slice(&c, version, available),
            available: slice(&c, available, end),
            source: source.map(|s| slice(&c, s, c.len())).unwrap_or_default(),
        };
        if !row.id.is_empty() && !row.name.is_empty() {
            out.push(row);
        }
    }
    out
}

pub fn is_safe_winget_id(id: &str) -> bool {
    let re = Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._+-]{1,127}$").unwrap();
    re.is_match(id)
}

pub fn scan() -> Res<Value> {
    let (_, stdout, stderr) = run_raw("winget", &["upgrade", "--accept-source-agreements", "--disable-interactivity"], Duration::from_secs(120))?;
    let text = if stdout.trim().is_empty() { stderr } else { stdout };
    let items: Vec<ScanItem> = parse_winget_upgrade(&text)
        .into_iter()
        .map(|u| {
            ScanItem::new(u.id.clone(), u.name.clone(), Risk::Low)
                .detail(format!("{}  ->  {}", u.version, u.available))
                .meta(json!({ "current": u.version, "available": u.available, "source": u.source }))
        })
        .collect();
    to_value(items)
}

pub fn record(id: &str, name: &str, applied: Applied) -> ItemResult {
    match applied.outcome {
        Outcome::Installed { version } => {
            ctx().log_add("apps", &format!("Installed {name} {version}"), "none", None);
            ItemResult::ok(id)
        }
        Outcome::Updated { from, to, note } => {
            ctx().log_add("updates", &format!("Updated {name} from {from} to {to}"), "appver", applied.undo);
            match note {
                Some(n) => ItemResult::ok_note(id, n),
                None => ItemResult::ok(id),
            }
        }
        Outcome::UpToDate => ItemResult::skipped(id, "Already up to date"),
        Outcome::Failed(reason) => ItemResult::failed(id, reason),
    }
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let w = Winget::system();
    w.ready()?;
    let mut out = vec![];
    for id in ids {
        if !is_safe_winget_id(&id) {
            out.push(ItemResult::skipped(&id, "Invalid package id"));
            continue;
        }
        let name = winget::installed_row(&w, &id).ok().flatten().map(|r| r.name).filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone());
        let progress = |step: &str| crate::ctx::emit("update:progress", json!({ "id": id, "message": format!("{name}: {step}") }));
        let applied = winget::install_or_update(&w, &id, &name, false, &progress);
        out.push(record(&id, &name, applied));
    }
    to_value(out)
}

pub fn revert(entry: &UndoEntry) -> Res<()> {
    let undo = entry.undo.clone().ok_or("Nothing to undo")?;
    winget::roll_back(&Winget::system(), &undo)
}

pub fn drivers() -> Res<Value> {
    let raw = run_ps_json(
        r#"Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DriverDate -and @("DISPLAY","NET","MEDIA","BLUETOOTH","HDC","USB","SYSTEM") -contains $_.DeviceClass } | Select-Object DeviceName, Manufacturer, DriverVersion, @{n="Date";e={$_.DriverDate.ToString("yyyy-MM-dd")}}, DeviceClass"#,
        Duration::from_secs(60),
    )?;
    let today = chrono::Local::now().date_naive();
    let mut items: Vec<(i64, ScanItem)> = raw
        .iter()
        .map(|d| {
            let date = str_field(d, "Date");
            let age = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map(|x| (today - x).num_days()).unwrap_or(0);
            let old = age > 365 * 2;
            let manufacturer = Some(str_field(d, "Manufacturer")).filter(|m| !m.is_empty()).unwrap_or_else(|| "Unknown".into());
            let (name, ver) = (str_field(d, "DeviceName"), str_field(d, "DriverVersion"));
            (
                age,
                ScanItem::new(format!("{name}|{ver}"), name, if old { Risk::Low } else { Risk::Safe })
                    .detail(format!("{manufacturer}  ·  v{ver}  ·  {date}"))
                    .meta(json!({ "ageDays": age, "old": old, "deviceClass": str_field(d, "DeviceClass") })),
            )
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0));
    to_value(items.into_iter().map(|(_, i)| i).collect::<Vec<_>>())
}

pub fn open_windows_update() -> Res<Value> {
    Command::new("explorer.exe").arg("ms-settings:windowsupdate").spawn().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(n: &str, i: &str, v: &str, a: &str, s: &str) -> String {
        format!("{n:<26}{i:<29}{v:<10}{a:<11}{s}")
    }

    fn sample() -> String {
        [
            "   - \\ |".to_string(),
            row("Name", "Id", "Version", "Available", "Source"),
            "-".repeat(80),
            row("Git", "Git.Git", "2.45.1", "2.46.0", "winget"),
            row("Visual Studio Code", "Microsoft.VisualStudioCode", "1.90.0", "1.91.1", "winget"),
            row("Mozilla Firefox (x64 en)", "Mozilla.Firefox", "127.0", "128.0", "winget"),
            "3 upgrades available.".to_string(),
        ]
        .join("\r\n")
    }

    #[test]
    fn parses_rows_with_spaces_in_names() {
        let rows = parse_winget_upgrade(&sample());
        assert_eq!(rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["Git.Git", "Microsoft.VisualStudioCode", "Mozilla.Firefox"]);
        assert_eq!(rows[2].name, "Mozilla Firefox (x64 en)");
        assert_eq!((rows[0].version.as_str(), rows[0].available.as_str(), rows[0].source.as_str()), ("2.45.1", "2.46.0", "winget"));
    }

    #[test]
    fn returns_nothing_when_nothing_is_outdated() {
        assert!(parse_winget_upgrade("No installed package found matching input criteria.").is_empty());
    }

    #[test]
    fn refuses_unsafe_package_ids() {
        assert!(is_safe_winget_id("Microsoft.VisualStudioCode"));
        assert!(!is_safe_winget_id("Git.Git; calc"));
        assert!(!is_safe_winget_id("--source"));
    }
}
