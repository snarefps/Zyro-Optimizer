use crate::ctx::ctx;
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::undo::UndoEntry;
use crate::util::{ps_arg, run_ps_json, run_ps_timeout, str_field};
use regex::Regex;
use serde_json::{json, Value};
use std::time::Duration;

pub struct Bloat {
    pub pattern: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
    pub risk: Risk,
}

const fn b(pattern: &'static str, label: &'static str, detail: &'static str, risk: Risk) -> Bloat {
    Bloat { pattern, label, detail, risk }
}

pub const BLOAT: &[Bloat] = &[
    b("Microsoft.BingNews", "Microsoft News", "News feed app", Risk::Safe),
    b("Microsoft.BingWeather", "Weather", "Weather app", Risk::Safe),
    b("Microsoft.BingSearch", "Bing Search", "Bing search app", Risk::Safe),
    b("Microsoft.GetHelp", "Get Help", "Microsoft support app", Risk::Safe),
    b("Microsoft.Getstarted", "Tips", "Windows tips app", Risk::Safe),
    b("Microsoft.MicrosoftOfficeHub", "Microsoft 365 hub", "Office promo and launcher app", Risk::Safe),
    b("Microsoft.MicrosoftSolitaireCollection", "Solitaire Collection", "Ad-supported card games", Risk::Safe),
    b("Microsoft.MixedReality.Portal", "Mixed Reality Portal", "VR headset portal", Risk::Safe),
    b("Microsoft.People", "People", "Contacts app", Risk::Safe),
    b("Microsoft.PowerAutomateDesktop", "Power Automate", "Automation tool", Risk::Low),
    b("Microsoft.Todos", "Microsoft To Do", "To-do list app", Risk::Low),
    b("Microsoft.WindowsFeedbackHub", "Feedback Hub", "Sends feedback to Microsoft", Risk::Safe),
    b("Microsoft.WindowsMaps", "Maps", "Offline maps app", Risk::Safe),
    b("Microsoft.ZuneVideo", "Movies & TV", "Video store and player", Risk::Safe),
    b("Microsoft.YourPhone", "Phone Link", "Connects Android/iPhone to the PC", Risk::Low),
    b("MicrosoftTeams", "Microsoft Teams (personal)", "Consumer Teams / Chat", Risk::Safe),
    b("MSTeams", "Microsoft Teams", "Teams app and its startup entry", Risk::Low),
    b("Clipchamp.Clipchamp", "Clipchamp", "Video editor", Risk::Safe),
    b("Microsoft.549981C3F5F10", "Cortana", "Legacy voice assistant", Risk::Safe),
    b("Microsoft.SkypeApp", "Skype", "Consumer Skype", Risk::Safe),
    b("microsoft.windowscommunicationsapps", "Mail and Calendar", "Legacy mail app", Risk::Low),
    b("Microsoft.OutlookForWindows", "New Outlook", "Preview mail app", Risk::Low),
    b("MicrosoftCorporationII.QuickAssist", "Quick Assist", "Remote help tool", Risk::Low),
    b("Microsoft.Windows.DevHome", "Dev Home", "Developer dashboard", Risk::Safe),
    b("Microsoft.3DBuilder", "3D Builder", "3D printing app", Risk::Safe),
    b("Microsoft.Microsoft3DViewer", "3D Viewer", "3D model viewer", Risk::Safe),
    b("Microsoft.Print3D", "Print 3D", "3D print app", Risk::Safe),
    b("Microsoft.OneConnect", "Mobile Plans", "Cellular plan app", Risk::Safe),
    b("Microsoft.Wallet", "Microsoft Pay", "Legacy payments app", Risk::Safe),
    b("Microsoft.GamingApp", "Xbox app", "Keep this if you use Game Pass or Xbox features", Risk::Medium),
    b("Microsoft.XboxGamingOverlay", "Xbox Game Bar", "Keep this if you use Win+G capture", Risk::Medium),
    b("Microsoft.XboxSpeechToTextOverlay", "Xbox speech overlay", "Game chat transcription", Risk::Low),
    b("*king.com.CandyCrush*", "Candy Crush", "Preinstalled promo game", Risk::Safe),
    b("*Disney*", "Disney+", "Preinstalled promo app", Risk::Safe),
    b("*Spotify*", "Spotify (Store version)", "Preinstalled promo app", Risk::Low),
    b("*TikTok*", "TikTok", "Preinstalled promo app", Risk::Safe),
    b("*Facebook*", "Facebook", "Preinstalled promo app", Risk::Safe),
    b("*Instagram*", "Instagram", "Preinstalled promo app", Risk::Safe),
    b("*Netflix*", "Netflix", "Preinstalled promo app", Risk::Low),
    b("*LinkedIn*", "LinkedIn", "Preinstalled promo app", Risk::Safe),
    b("*AmazonAlexa*", "Amazon Alexa", "Preinstalled promo app", Risk::Safe),
    b("*Twitter*", "Twitter / X", "Preinstalled promo app", Risk::Safe),
    b("*McAfee*", "McAfee trial", "Preinstalled trial software", Risk::Low),
    b("*PrimeVideo*", "Prime Video", "Preinstalled promo app", Risk::Safe),
];

pub fn match_bloat(package: &str) -> Option<&'static Bloat> {
    BLOAT.iter().find(|b| {
        if !b.pattern.contains('*') {
            return b.pattern.eq_ignore_ascii_case(package);
        }
        let re = format!("^(?i){}$", regex::escape(b.pattern).replace(r"\*", ".*"));
        Regex::new(&re).map(|r| r.is_match(package)).unwrap_or(false)
    })
}

const LIST_SCRIPT: &str = "Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable } | Select-Object Name, PackageFullName, InstallLocation";

pub fn scan() -> Res<Value> {
    let pkgs = run_ps_json(LIST_SCRIPT, Duration::from_secs(60))?;
    let mut items: Vec<ScanItem> = vec![];
    for p in &pkgs {
        let name = str_field(p, "Name");
        let Some(b) = match_bloat(&name) else { continue };
        // wildcard matches can be apps the user installed on purpose, so never call them "safe"
        let wild = b.pattern.contains('*');
        let risk = if wild && b.risk == Risk::Safe { Risk::Low } else { b.risk };
        let (label, detail) = if wild {
            (name.clone(), format!("{}. Third-party Store app, only remove it if you do not use it", b.detail))
        } else {
            (b.label.to_string(), format!("{} ({name})", b.detail))
        };
        items.push(ScanItem::new(str_field(p, "PackageFullName"), label, risk).detail(detail).meta(json!({ "name": name, "location": p.get("InstallLocation").cloned().unwrap_or(Value::Null) })));
    }
    items.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    to_value(items)
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let installed = run_ps_json("Get-AppxPackage | Select-Object Name, PackageFullName, InstallLocation", Duration::from_secs(60))?;
    let mut out = vec![];
    for id in ids {
        let pkg = installed.iter().find(|p| str_field(p, "PackageFullName") == id);
        let Some((pkg, b)) = pkg.and_then(|p| match_bloat(&str_field(p, "Name")).map(|b| (p, b))) else {
            out.push(ItemResult::skipped(&id, "Not on the removable list"));
            continue;
        };
        ctx().log_add(
            "debloat",
            &format!("Removed app: {}", b.label),
            "appx",
            Some(json!({ "name": str_field(pkg, "Name"), "location": pkg.get("InstallLocation").cloned().unwrap_or(Value::Null) })),
        );
        let script = format!("{}Remove-AppxPackage -Package $a.full", ps_arg(&json!({ "full": id })));
        out.push(match run_ps_timeout(&script, Duration::from_secs(180)) {
            Ok(_) => ItemResult::ok(&id),
            Err(e) => ItemResult::failed(&id, e),
        });
    }
    to_value(out)
}

pub fn revert(entry: &UndoEntry) -> Res<()> {
    let u = entry.undo.clone().ok_or("Nothing to undo")?;
    let loc = u.get("location").and_then(|v| v.as_str()).ok_or("Reinstall this app from the Microsoft Store")?;
    let script = format!(
        "{}$m = Join-Path $a.loc 'AppXManifest.xml'; if (Test-Path $m) {{ Add-AppxPackage -DisableDevelopmentMode -Register $m }} else {{ throw 'The package files are gone. Reinstall this app from the Microsoft Store.' }}",
        ps_arg(&json!({ "loc": loc }))
    );
    run_ps_timeout(&script, Duration::from_secs(180)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_exact_and_wildcard_names_but_never_core_apps() {
        assert_eq!(match_bloat("Microsoft.BingNews").unwrap().label, "Microsoft News");
        assert_eq!(match_bloat("king.com.CandyCrushSaga").unwrap().label, "Candy Crush");
        for core in [
            "Microsoft.WindowsStore",
            "Microsoft.Windows.Photos",
            "Microsoft.WindowsCalculator",
            "Microsoft.WindowsTerminal",
            "windows.immersivecontrolpanel",
            "Microsoft.DesktopAppInstaller",
            "Microsoft.SecHealthUI",
        ] {
            assert!(match_bloat(core).is_none(), "{core} must never be offered");
        }
    }

    #[test]
    fn wildcard_matches_are_not_labelled_safe_in_the_scan_logic() {
        let b = match_bloat("Facebook.InstagramBeta").unwrap();
        assert!(b.pattern.contains('*'));
    }
}
