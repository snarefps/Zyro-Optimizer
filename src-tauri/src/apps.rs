use crate::ctx::{ctx, emit};
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::util::run_raw;
use crate::winget::{self, Winget};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

struct App {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    note: &'static str,
}

const fn app(id: &'static str, name: &'static str, category: &'static str, note: &'static str) -> App {
    App { id, name, category, note }
}

const CATALOG: &[App] = &[
    app("Google.Chrome", "Google Chrome", "Browsers", "Fast, huge extension store"),
    app("Mozilla.Firefox", "Mozilla Firefox", "Browsers", "Open source, strong privacy controls"),
    app("Brave.Brave", "Brave", "Browsers", "Chromium based with a built-in ad blocker"),
    app("Opera.Opera", "Opera", "Browsers", "Built-in VPN and sidebar apps"),
    app("Vivaldi.Vivaldi", "Vivaldi", "Browsers", "Highly customizable"),
    app("TorProject.TorBrowser", "Tor Browser", "Browsers", "Private browsing over the Tor network"),

    app("Tonec.InternetDownloadManager", "Internet Download Manager", "Download managers", "Official installer. Runs as a trial until you add your own license"),
    app("SoftDeluxe.FreeDownloadManager", "Free Download Manager", "Download managers", "Free, accelerates downloads and handles torrents"),
    app("qBittorrent.qBittorrent", "qBittorrent", "Download managers", "Open source torrent client without ads"),

    app("VideoLAN.VLC", "VLC media player", "Media", "Plays almost any video or audio file"),
    app("Daum.PotPlayer", "PotPlayer", "Media", "Lightweight player with many options"),
    app("clsid2.mpc-hc", "MPC-HC", "Media", "Classic, very light video player"),
    app("Spotify.Spotify", "Spotify", "Media", "Music streaming"),
    app("Audacity.Audacity", "Audacity", "Media", "Audio recorder and editor"),
    app("HandBrake.HandBrake", "HandBrake", "Media", "Video converter"),
    app("OBSProject.OBSStudio", "OBS Studio", "Media", "Screen recording and streaming"),

    app("7zip.7zip", "7-Zip", "Utilities", "Free archiver for zip, rar, 7z and more"),
    app("RARLab.WinRAR", "WinRAR", "Utilities", "Archiver. Trial version from the official installer"),
    app("voidtools.Everything", "Everything", "Utilities", "Instant file search"),
    app("Notepad++.Notepad++", "Notepad++", "Utilities", "Text and code editor"),
    app("Microsoft.PowerToys", "PowerToys", "Utilities", "Extra Windows tools from Microsoft"),
    app("ShareX.ShareX", "ShareX", "Utilities", "Screenshots and screen capture"),
    app("SumatraPDF.SumatraPDF", "SumatraPDF", "Utilities", "Light PDF reader"),
    app("Adobe.Acrobat.Reader.64-bit", "Adobe Acrobat Reader", "Utilities", "PDF reader"),
    app("AnyDesk.AnyDesk", "AnyDesk", "Utilities", "Remote desktop"),
    app("Rufus.Rufus", "Rufus", "Utilities", "Create bootable USB drives"),
    app("CPUID.CPU-Z", "CPU-Z", "Utilities", "CPU and memory details"),
    app("TechPowerUp.GPU-Z", "GPU-Z", "Utilities", "Graphics card details"),

    app("Telegram.TelegramDesktop", "Telegram", "Communication", "Messenger"),
    app("Discord.Discord", "Discord", "Communication", "Voice and text chat for communities"),
    app("Zoom.Zoom", "Zoom", "Communication", "Video meetings"),

    app("Microsoft.VisualStudioCode", "Visual Studio Code", "Developer", "Code editor"),
    app("Git.Git", "Git", "Developer", "Version control"),
    app("GitHub.GitHubDesktop", "GitHub Desktop", "Developer", "Git with a simple interface"),
    app("Python.Python.3.13", "Python 3.13", "Developer", "Python runtime"),
    app("OpenJS.NodeJS.LTS", "Node.js LTS", "Developer", "JavaScript runtime"),

    app("Valve.Steam", "Steam", "Gaming", "Game store and launcher"),
    app("EpicGames.EpicGamesLauncher", "Epic Games Launcher", "Gaming", "Game store and launcher"),
    app("Microsoft.VCRedist.2015+.x64", "Visual C++ Runtime (x64)", "Runtimes", "Needed by many games and apps"),
    app("Microsoft.VCRedist.2015+.x86", "Visual C++ Runtime (x86)", "Runtimes", "Needed by many 32-bit games and apps"),
    app("Microsoft.DotNet.DesktopRuntime.8", ".NET Desktop Runtime 8", "Runtimes", "Needed by many Windows apps"),
    app("Microsoft.DirectX", "DirectX End-User Runtime", "Runtimes", "Older DirectX files some games still ask for"),
];

fn howto(id: &str) -> Option<&'static str> {
    Some(match id {
        "Tonec.InternetDownloadManager" => "Open Internet Download Manager after the install, then choose Registration in the Help menu to enter a license key you bought. Without a key it runs as a trial. Zyro does not supply or apply license keys.",
        "RARLab.WinRAR" => "WinRAR keeps working after its trial and only shows a reminder. To remove the reminder, enter a license you bought under Help, then Enter registration code.",
        "Valve.Steam" | "EpicGames.EpicGamesLauncher" | "Spotify.Spotify" | "Discord.Discord" | "Zoom.Zoom" | "Telegram.TelegramDesktop" => "Open the app after the install and sign in with your own account.",
        "Python.Python.3.13" | "Git.Git" | "OpenJS.NodeJS.LTS" => "Open a new terminal window after the install so the updated PATH is picked up.",
        id if id.starts_with("Microsoft.VCRedist") || id.starts_with("Microsoft.DotNet") || id == "Microsoft.DirectX" => "A runtime has no window. Restart the game or app that asked for it once the install finishes.",
        _ => return None,
    })
}

pub fn scan() -> Res<Value> {
    let w = Winget::system();
    w.ready()?;
    let have = winget::list_all(&w)?;
    let items: Vec<ScanItem> = catalog()
        .iter()
        .map(|a| {
            let found = have.get(&a.id.to_lowercase());
            ScanItem::new(a.id.clone(), a.name.clone(), Risk::Safe).detail(a.note.clone()).meta(json!({
                "category": a.category,
                "installed": found.is_some(),
                "version": found.map(|f| f.version.clone()),
                "update": found.map(|f| f.available.clone()).filter(|v| !v.is_empty())
            }))
        })
        .collect();
    to_value(items)
}

pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub category: String,
    pub note: String,
}

fn catalog() -> Vec<AppEntry> {
    CATALOG
        .iter()
        .map(|a| AppEntry { id: a.id.into(), name: a.name.into(), category: a.category.into(), note: a.note.into() })
        .collect()
}

fn catalog_entry(id: &str) -> Res<AppEntry> {
    catalog().into_iter().find(|a| a.id == id).ok_or_else(|| "Not in the app list".to_string())
}

fn parse_show(text: &str) -> HashMap<String, String> {
    let wanted = ["Version", "Publisher", "Homepage", "License", "Installer Type", "Installer Url", "Installer SHA256", "Release Date"];
    let mut out = HashMap::new();
    for line in text.lines() {
        if let Some((k, v)) = line.trim().split_once(": ") {
            if wanted.contains(&k) && !out.contains_key(k) {
                out.insert(k.to_string(), v.trim().to_string());
            }
        }
    }
    out
}

fn last_line(text: &str, fallback: &str) -> String {
    text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or(fallback).trim().to_string()
}

pub fn info(id: String) -> Res<Value> {
    let entry = catalog_entry(&id)?;
    Winget::system().ready()?;
    let (ok, stdout, stderr) = run_raw(
        "winget",
        &["show", "--id", &entry.id, "--exact", "--source", "winget", "--accept-source-agreements", "--disable-interactivity"],
        Duration::from_secs(60),
    )?;
    if !ok {
        return Err(last_line(if stderr.trim().is_empty() { &stdout } else { &stderr }, "winget could not read this package"));
    }
    let f = parse_show(&stdout);
    let get = |k: &str| f.get(k).cloned().unwrap_or_default();
    Ok(json!({
        "id": entry.id, "name": entry.name,
        "version": get("Version"), "publisher": get("Publisher"), "homepage": get("Homepage"), "license": get("License"),
        "installerType": get("Installer Type"), "installerUrl": get("Installer Url"), "sha256": get("Installer SHA256"), "releaseDate": get("Release Date"),
        "howto": howto(&entry.id)
    }))
}

fn manifest_hashes(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("Installer SHA256:"))
        .map(|h| h.trim().to_lowercase())
        .filter(|h| h.len() == 64)
        .collect()
}

fn sha256_file(path: &Path) -> Res<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn installers_dir() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("Downloads").join("Zyro Installers")
}

fn download_to(id: &str, base: &Path) -> Res<Value> {
    let entry = catalog_entry(id)?;
    Winget::system().ready()?;
    let dir = base.join(&entry.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir_arg = dir.to_string_lossy().to_string();
    let (ok, stdout, stderr) = run_raw(
        "winget",
        &["download", "--id", &entry.id, "--exact", "--source", "winget", "--download-directory", &dir_arg, "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"],
        Duration::from_secs(1500),
    )?;
    let mut saved: Vec<(String, u64, String)> = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_file() {
                saved.push((e.file_name().to_string_lossy().to_string(), meta.len(), sha256_file(&e.path())?));
            }
        }
    }
    if !ok || saved.is_empty() {
        return Ok(json!({ "ok": false, "reason": last_line(if stderr.trim().is_empty() { &stdout } else { &stderr }, "The download failed") }));
    }
    let (_, shown, _) = run_raw(
        "winget",
        &["show", "--id", &entry.id, "--exact", "--source", "winget", "--accept-source-agreements", "--disable-interactivity"],
        Duration::from_secs(60),
    )
    .unwrap_or((false, String::new(), String::new()));
    let published = manifest_hashes(&shown);
    let verified = !published.is_empty() && saved.iter().any(|(_, _, h)| published.contains(h));
    if !verified {
        for (name, _, _) in &saved {
            let _ = std::fs::remove_file(dir.join(name));
        }
        let why = if published.is_empty() { "winget did not publish a checksum to compare with" } else { "does not match the checksum in the winget manifest" };
        return Ok(json!({ "ok": false, "reason": format!("The downloaded installer was deleted: it {why}") }));
    }
    let files: Vec<Value> = saved.iter().map(|(n, size, h)| json!({ "name": n, "size": size, "sha256": h })).collect();
    Ok(json!({ "ok": true, "verified": true, "folder": dir_arg, "files": files }))
}

pub fn download(id: String) -> Res<Value> {
    let r = download_to(&id, &installers_dir())?;
    if r["ok"] == true {
        ctx().log_add("apps", &format!("Saved installer: {id}"), "none", None);
    }
    Ok(r)
}

pub fn helper() -> Res<Value> {
    let exe = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("resources").join("Helper.exe")));
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("Helper.exe");
    let path = exe.filter(|p| p.exists()).or_else(|| dev.exists().then_some(dev)).ok_or("resources/Helper.exe was not found next to Zyro")?;
    std::process::Command::new(&path).spawn().map_err(|e| match e.raw_os_error() {
        Some(740) => "Helper needs administrator rights.".to_string(),
        _ => format!("Could not start Helper: {e}"),
    })?;
    Ok(json!(true))
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let w = Winget::system();
    w.ready()?;
    let mut out = vec![];
    for id in ids {
        let Some(entry) = catalog().into_iter().find(|a| a.id == id) else {
            out.push(ItemResult::skipped(&id, "Not in the app list"));
            continue;
        };
        let progress = |step: &str| emit("update:progress", json!({ "id": id, "message": format!("{}: {step}", entry.name) }));
        let applied = winget::install_or_update(&w, &entry.id, &entry.name, true, &progress);
        out.push(crate::updates::record(&id, &entry.name, applied));
    }
    to_value(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn reads_package_details_from_winget_show() {
        let f = parse_show("Found VLC [VideoLAN.VLC]\nVersion: 3.0.24\nPublisher: VideoLAN\nHomepage: https://www.videolan.org/vlc/\nLicense: GPL-2.0\nInstaller:\n  Installer Type: wix\n  Installer Url: https://example.org/a.msi\n  Installer SHA256: abc123\n  Release Date: 2026-09-21\n");
        assert_eq!(f["Version"], "3.0.24");
        assert_eq!(f["Installer Url"], "https://example.org/a.msi");
        assert_eq!(f["Installer SHA256"], "abc123");
    }

    #[test]
    fn reads_every_published_hash_and_hashes_files() {
        let h = "Installer:
  Installer SHA256: ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789
  Installer SHA256: short
";
        assert_eq!(manifest_hashes(h), vec!["abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".to_string()]);
        let p = std::env::temp_dir().join(format!("zyro-hash-{}", crate::util::now_ms()));
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn only_catalog_apps_can_be_queried_or_downloaded() {
        assert!(info("Evil.Package".into()).is_err());
        assert!(download_to("Evil.Package", &std::env::temp_dir()).is_err());
        assert!(howto("Tonec.InternetDownloadManager").unwrap().contains("does not supply"));
    }

    #[test]
    #[ignore]
    fn downloads_a_real_installer_and_reads_its_info() {
        let _turn = crate::winget::REAL_WINGET.lock().unwrap_or_else(|e| e.into_inner());
        let i = info("7zip.7zip".into()).expect("info");
        assert!(i["installerUrl"].as_str().unwrap().starts_with("https://"));
        let dir = std::env::temp_dir().join(format!("zyro-dl-{}", crate::util::now_ms()));
        let r = download_to("7zip.7zip", &dir).expect("download");
        println!("{r}");
        assert_eq!(r["ok"], true);
        assert_eq!(r["verified"], true);
        assert_eq!(r["files"][0]["sha256"].as_str().unwrap().len(), 64);
        assert!(r["files"][0]["size"].as_u64().unwrap() > 100_000);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn catalog_ids_are_unique_and_safe() {
        let mut seen = HashSet::new();
        for a in CATALOG {
            assert!(seen.insert(a.id), "duplicate {}", a.id);
            assert!(crate::updates::is_safe_winget_id(a.id), "{}", a.id);
            assert!(!a.name.is_empty() && !a.note.is_empty());
        }
        assert!(CATALOG.len() > 30);
    }

    #[test]
    fn scan_marks_installed_apps_from_the_real_machine() {
        let _turn = crate::winget::REAL_WINGET.lock().unwrap_or_else(|e| e.into_inner());
        let v = scan().expect("scan failed");
        let list = v.as_array().unwrap();
        assert_eq!(list.len(), CATALOG.len());
        let git = list.iter().find(|i| i["id"] == "Git.Git").unwrap();
        assert!(git["meta"]["installed"].is_boolean());
    }
}
