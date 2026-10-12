use crate::ctx::{ctx, is_admin};
use crate::model::{to_value, ItemResult, Res, Risk, ScanItem};
use crate::registry::{self, Raw};
use crate::sysutil::{activate_plan, active_power, service_start, set_active_plan, set_service_start};
use crate::undo::UndoEntry;
use crate::util::{run_exe, run_exe_timeout, run_ps_timeout};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Command;
use std::time::Duration;

pub enum Op {
    Reg { key: &'static str, name: &'static str, value: Raw, delete_key_on_revert: bool },
    Service { name: &'static str, startup: &'static str },
    Power { ultimate: bool },
}

pub struct Tweak {
    pub id: &'static str,
    pub category: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub risk: Risk,
    pub needs_admin: bool,
    pub needs_restart: bool,
    pub ops: Vec<Op>,
}

fn reg(key: &'static str, name: &'static str, value: Raw) -> Op {
    Op::Reg { key, name, value, delete_key_on_revert: false }
}

fn tw(id: &'static str, category: &'static str, label: &'static str, description: &'static str, risk: Risk, ops: Vec<Op>) -> Tweak {
    Tweak { id, category, label, description, risk, needs_admin: false, needs_restart: false, ops }
}

const CDM: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager";
const ADV: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
const SYSPROFILE: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
const POLICY_SYSTEM: &str = r"HKLM\SOFTWARE\Policies\Microsoft\Windows\System";

fn admin(mut t: Tweak) -> Tweak {
    t.needs_admin = true;
    t
}
fn restart(mut t: Tweak) -> Tweak {
    t.needs_restart = true;
    t
}

pub fn catalog() -> Vec<Tweak> {
    use Risk::*;
    vec![
        admin(tw("telemetry-off", "Privacy", "Reduce Windows telemetry", "Sets the diagnostic data level to the minimum and stops the Connected User Experiences (DiagTrack) service.", Low, vec![
            reg(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\DataCollection", "AllowTelemetry", Raw::dword(0)),
            Op::Service { name: "DiagTrack", startup: "disabled" },
        ])),
        tw("ad-id-off", "Privacy", "Turn off advertising ID", "Stops apps from using a unique advertising ID to track you across apps.", Safe, vec![
            reg(r"HKCU\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo", "Enabled", Raw::dword(0)),
        ]),
        tw("tailored-off", "Privacy", "Turn off tailored experiences", "Stops Windows using diagnostic data to show personalised tips and ads.", Safe, vec![
            reg(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Privacy", "TailoredExperiencesWithDiagnosticDataEnabled", Raw::dword(0)),
        ]),
        tw("suggestions-off", "Privacy", "Remove Start menu and lock screen ads", "Disables suggested apps, promoted tiles, tips and \"fun facts\" injected by Windows.", Safe, vec![
            reg(CDM, "SubscribedContent-338388Enabled", Raw::dword(0)),
            reg(CDM, "SubscribedContent-338389Enabled", Raw::dword(0)),
            reg(CDM, "SubscribedContent-353694Enabled", Raw::dword(0)),
            reg(CDM, "SubscribedContent-353696Enabled", Raw::dword(0)),
            reg(CDM, "SystemPaneSuggestionsEnabled", Raw::dword(0)),
            reg(CDM, "SoftLandingEnabled", Raw::dword(0)),
            reg(CDM, "RotatingLockScreenOverlayEnabled", Raw::dword(0)),
        ]),
        admin(tw("activity-history-off", "Privacy", "Turn off activity history", "Stops Windows recording and uploading the apps and files you open (Timeline).", Safe, vec![
            reg(POLICY_SYSTEM, "EnableActivityFeed", Raw::dword(0)),
            reg(POLICY_SYSTEM, "PublishUserActivities", Raw::dword(0)),
            reg(POLICY_SYSTEM, "UploadUserActivities", Raw::dword(0)),
        ])),
        tw("bing-search-off", "Privacy", "Disable web results in Start search", "Start menu search only looks at your PC, which is faster and does not send your queries to Bing.", Safe, vec![
            reg(r"HKCU\Software\Policies\Microsoft\Windows\Explorer", "DisableSearchBoxSuggestions", Raw::dword(1)),
        ]),
        tw("copilot-off", "Privacy", "Turn off Windows Copilot", "Applies the policy that disables the Copilot sidebar and taskbar button.", Safe, vec![
            reg(r"HKCU\Software\Policies\Microsoft\Windows\WindowsCopilot", "TurnOffWindowsCopilot", Raw::dword(1)),
        ]),
        restart(tw("visual-fx-perf", "Performance", "Faster menus and window animations", "Removes menu delay and minimise/maximise animations so the interface feels snappier.", Safe, vec![
            reg(r"HKCU\Control Panel\Desktop", "MenuShowDelay", Raw::sz("0")),
            reg(r"HKCU\Control Panel\Desktop\WindowMetrics", "MinAnimate", Raw::sz("0")),
            reg(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects", "VisualFXSetting", Raw::dword(2)),
        ])),
        tw("transparency-off", "Performance", "Turn off transparency effects", "Disables the blur and transparency in the taskbar and windows. Uses less GPU.", Safe, vec![
            reg(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", Raw::dword(0)),
        ]),
        admin(tw("fast-shutdown", "Performance", "Faster shutdown", "Cuts the time Windows waits for apps and services to close from 5 s to 2 s and auto-ends hung apps.", Low, vec![
            reg(r"HKLM\SYSTEM\CurrentControlSet\Control", "WaitToKillServiceTimeout", Raw::sz("2000")),
            reg(r"HKCU\Control Panel\Desktop", "WaitToKillAppTimeout", Raw::sz("2000")),
            reg(r"HKCU\Control Panel\Desktop", "HungAppTimeout", Raw::sz("2000")),
            reg(r"HKCU\Control Panel\Desktop", "AutoEndTasks", Raw::sz("1")),
        ])),
        admin(tw("sysmain-off", "Performance", "Disable SysMain (Superfetch) on SSDs", "SysMain preloads apps into RAM, which gives little benefit on an SSD and can cause disk activity. Skip this if you use a hard drive.", Medium, vec![
            Op::Service { name: "SysMain", startup: "disabled" },
        ])),
        tw("plan-high", "Performance", "High Performance power plan", "Keeps the CPU responsive instead of throttling down. Uses more power, so best for desktops.", Low, vec![Op::Power { ultimate: false }]),
        tw("plan-ultimate", "Performance", "Ultimate Performance power plan", "Removes micro-latencies for the highest performance. Uses the most power. Best for desktops and gaming PCs.", Medium, vec![Op::Power { ultimate: true }]),
        tw("game-mode-on", "Gaming", "Turn on Game Mode", "Tells Windows to prioritise the game you are playing and hold back background updates.", Safe, vec![
            reg(r"HKCU\Software\Microsoft\GameBar", "AutoGameModeEnabled", Raw::dword(1)),
            reg(r"HKCU\Software\Microsoft\GameBar", "AllowAutoGameMode", Raw::dword(1)),
        ]),
        tw("game-dvr-off", "Gaming", "Disable background game recording", "Stops Game DVR recording in the background, which costs frames per second.", Safe, vec![
            reg(r"HKCU\System\GameConfigStore", "GameDVR_Enabled", Raw::dword(0)),
            reg(r"HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled", Raw::dword(0)),
        ]),
        restart(admin(tw("hags-on", "Gaming", "Hardware-accelerated GPU scheduling", "Lets the GPU manage its own memory scheduling. Can reduce latency on supported GPUs and drivers. Needs a restart.", Medium, vec![
            reg(r"HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode", Raw::dword(2)),
        ]))),
        admin(tw("net-throttle-off", "Network", "Remove network throttling", "Disables the multimedia network throttle index, which can limit throughput while media or games run.", Low, vec![
            reg(SYSPROFILE, "NetworkThrottlingIndex", Raw::dword(0xffff_ffff)),
        ])),
        admin(tw("system-responsiveness", "Network", "Prioritise foreground apps", "Reserves less CPU for background multimedia tasks so the app you are using gets more.", Low, vec![
            reg(SYSPROFILE, "SystemResponsiveness", Raw::dword(10)),
        ])),
        restart(tw("classic-context-menu", "Windows 11", "Classic right-click menu", "Brings back the full right-click menu instead of the \"Show more options\" step. Takes effect after Explorer restarts.", Safe, vec![
            Op::Reg { key: r"HKCU\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32", name: "", value: Raw::sz(""), delete_key_on_revert: true },
        ])),
        tw("show-extensions", "Windows 11", "Show file extensions", "Always shows .exe, .pdf and other extensions. Safer and clearer.", Safe, vec![reg(ADV, "HideFileExt", Raw::dword(0))]),
        tw("show-hidden", "Windows 11", "Show hidden files", "Makes hidden files and folders visible in File Explorer.", Safe, vec![reg(ADV, "Hidden", Raw::dword(1))]),
        tw("explorer-this-pc", "Windows 11", "Open File Explorer to \"This PC\"", "Opens drives and folders instead of the Home page.", Safe, vec![reg(ADV, "LaunchTo", Raw::dword(1))]),
        tw("taskbar-left", "Windows 11", "Align taskbar to the left", "Moves the Start button and icons to the left like Windows 10.", Safe, vec![reg(ADV, "TaskbarAl", Raw::dword(0))]),
        tw("widgets-off", "Windows 11", "Remove Widgets button", "Hides the Widgets button from the taskbar.", Safe, vec![reg(ADV, "TaskbarDa", Raw::dword(0))]),
    ]
}

fn is_op_applied(op: &Op) -> bool {
    match op {
        Op::Reg { key, name, value, .. } => registry::read(key, name).map(|c| c.same(value)).unwrap_or(false),
        // a missing service counts as already off
        Op::Service { name, startup } => service_start(name).map(|s| s == *startup).unwrap_or(true),
        Op::Power { ultimate } => {
            let want = if *ultimate { "ultimate performance" } else { "high performance" };
            active_power().map(|(_, n)| n.to_lowercase().contains(want)).unwrap_or(false)
        }
    }
}

fn is_applied(t: &Tweak) -> bool {
    t.ops.iter().all(is_op_applied)
}

pub fn scan() -> Res<Value> {
    let adm = is_admin();
    let all = catalog();
    let mut items: Vec<Option<ScanItem>> = (0..all.len()).map(|_| None).collect();
    std::thread::scope(|s| {
        for (slot, t) in items.iter_mut().zip(all.iter()) {
            s.spawn(move || {
                *slot = Some(
                    ScanItem::new(t.id, t.label, t.risk)
                        .detail(t.description)
                        .admin(t.needs_admin && !adm)
                        .meta(json!({ "category": t.category, "applied": is_applied(t), "needsRestart": t.needs_restart })),
                );
            });
        }
    });
    to_value(items.into_iter().flatten().collect::<Vec<_>>())
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RegUndo {
    key: String,
    name: String,
    old: Option<Raw>,
    delete_key_on_revert: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SvcUndo {
    name: String,
    old: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TweakUndo {
    tweak_id: String,
    regs: Vec<RegUndo>,
    services: Vec<SvcUndo>,
    power: Option<String>,
}

fn apply_one(t: &Tweak) -> Res<()> {
    let mut undo = TweakUndo { tweak_id: t.id.into(), ..Default::default() };
    for op in &t.ops {
        match op {
            Op::Reg { key, name, delete_key_on_revert, .. } => undo.regs.push(RegUndo {
                key: (*key).into(),
                name: (*name).into(),
                old: registry::read(key, name),
                delete_key_on_revert: *delete_key_on_revert,
            }),
            Op::Service { name, .. } => {
                if let Some(old) = service_start(name) {
                    undo.services.push(SvcUndo { name: (*name).into(), old });
                }
            }
            Op::Power { .. } => undo.power = active_power().map(|(g, _)| g),
        }
    }
    // log first so a failure half way through can still be undone
    let entry = ctx().log_add("tweaks", &format!("Applied: {}", t.label), "registry", Some(serde_json::to_value(&undo).map_err(|e| e.to_string())?));
    let run = || -> Res<()> {
        for op in &t.ops {
            match op {
                Op::Reg { key, name, value, .. } => registry::write(key, name, value)?,
                Op::Service { name, startup } => {
                    if service_start(name).is_some() {
                        set_service_start(name, startup)?;
                    }
                }
                Op::Power { ultimate } => activate_plan(*ultimate)?,
            }
        }
        Ok(())
    };
    if let Err(e) = run() {
        let _ = revert_tweak(&entry);
        ctx().log_mark_reverted(&entry.id);
        return Err(e);
    }
    Ok(())
}

pub fn revert_tweak(entry: &UndoEntry) -> Res<()> {
    let u: TweakUndo = serde_json::from_value(entry.undo.clone().ok_or("Nothing to undo")?).map_err(|e| e.to_string())?;
    for r in u.regs.iter().rev() {
        match &r.old {
            Some(old) => {
                let _ = registry::write(&r.key, &r.name, old);
            }
            None if r.delete_key_on_revert => {
                let _ = registry::delete_key(&r.key);
            }
            None => {
                let _ = registry::delete_value(&r.key, &r.name);
            }
        }
    }
    for s in &u.services {
        let _ = set_service_start(&s.name, &s.old);
    }
    if let Some(g) = &u.power {
        let _ = set_active_plan(g);
    }
    Ok(())
}

pub fn apply(ids: Vec<String>) -> Res<Value> {
    let adm = is_admin();
    let all = catalog();
    let mut out = vec![];
    for id in ids {
        let Some(t) = all.iter().find(|x| x.id == id) else {
            out.push(ItemResult::failed(&id, "Unknown tweak"));
            continue;
        };
        if t.needs_admin && !adm {
            out.push(ItemResult::skipped(&id, "Needs administrator rights"));
            continue;
        }
        if is_applied(t) {
            out.push(ItemResult::skipped(&id, "Already applied"));
            continue;
        }
        out.push(match apply_one(t) {
            Ok(()) if t.needs_restart => ItemResult::ok_note(&id, "Restart or sign out to finish"),
            Ok(()) => ItemResult::ok(&id),
            Err(e) => ItemResult::failed(&id, e),
        });
    }
    to_value(out)
}

pub fn revert(id: String) -> Res<Value> {
    let entry = ctx().log_list().into_iter().find(|e| {
        e.module == "tweaks" && !e.reverted && e.undo.as_ref().and_then(|u| u.get("tweakId")).and_then(|v| v.as_str()) == Some(id.as_str())
    });
    let Some(entry) = entry else {
        return to_value(ItemResult::skipped(&id, "Nothing to undo. This tweak was not applied by Zyro."));
    };
    match revert_tweak(&entry) {
        Ok(()) => {
            ctx().log_mark_reverted(&entry.id);
            to_value(ItemResult::ok(&id))
        }
        Err(e) => to_value(ItemResult::failed(&id, e)),
    }
}

struct Action {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    needs_admin: bool,
}

const ACTIONS: &[Action] = &[
    Action { id: "flush-dns", label: "Flush DNS cache", description: "Clears stale DNS entries. Fixes sites that will not load after network changes.", needs_admin: false },
    Action { id: "trim-ssd", label: "Optimize SSD (TRIM)", description: "Sends a TRIM command to the C: drive so the SSD can reclaim free blocks.", needs_admin: true },
    Action { id: "dism-cleanup", label: "Clean Windows component store", description: "Removes superseded Windows update components with DISM. Can take several minutes.", needs_admin: true },
    Action { id: "restart-explorer", label: "Restart Windows Explorer", description: "Applies shell tweaks such as the classic right-click menu. The taskbar flickers once.", needs_admin: false },
];

pub fn actions_list() -> Res<Value> {
    let adm = is_admin();
    to_value(
        ACTIONS
            .iter()
            .map(|a| json!({ "id": a.id, "label": a.label, "description": a.description, "needsAdmin": a.needs_admin && !adm }))
            .collect::<Vec<_>>(),
    )
}

pub fn run_action(id: String) -> Res<Value> {
    let Some(a) = ACTIONS.iter().find(|x| x.id == id) else {
        return to_value(ItemResult::failed(&id, "Unknown action"));
    };
    if a.needs_admin && !is_admin() {
        return to_value(ItemResult::skipped(&id, "Needs administrator rights"));
    }
    let res: Res<String> = match a.id {
        "flush-dns" => run_exe("ipconfig", &["/flushdns"]).map(|o| o.trim().to_string()),
        "trim-ssd" => run_ps_timeout("Optimize-Volume -DriveLetter C -ReTrim", Duration::from_secs(600)).map(|_| "TRIM completed".into()),
        "dism-cleanup" => run_exe_timeout("dism", &["/online", "/Cleanup-Image", "/StartComponentCleanup"], Duration::from_secs(1200)).map(|_| "Component store cleaned".into()),
        _ => {
            let _ = run_exe("taskkill", &["/f", "/im", "explorer.exe"]);
            Command::new("explorer.exe").spawn().map(|_| "Explorer restarted".to_string()).map_err(|e| e.to_string())
        }
    };
    to_value(match res {
        Ok(msg) => ItemResult::ok_note(&id, msg),
        Err(e) => ItemResult::failed(&id, e),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique_and_complete() {
        let c = catalog();
        let mut ids: Vec<_> = c.iter().map(|t| t.id).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n);
        assert_eq!(n, 24, "update the README count if you add or remove tweaks");
        for t in &c {
            assert!(t.label.len() > 3 && t.description.len() > 10 && !t.ops.is_empty(), "{}", t.id);
        }
    }

    #[test]
    fn registry_roots_are_valid_and_admin_flags_are_right() {
        for t in catalog() {
            let mut needs = false;
            for op in &t.ops {
                match op {
                    Op::Reg { key, .. } => {
                        assert!(key.starts_with(r"HKCU\") || key.starts_with(r"HKLM\"), "{}", t.id);
                        needs |= key.starts_with("HKLM");
                    }
                    Op::Service { .. } => needs = true,
                    Op::Power { .. } => {}
                }
            }
            if needs {
                assert!(t.needs_admin, "{} writes HKLM or a service but is not flagged admin", t.id);
            }
        }
    }

    #[test]
    fn apply_and_revert_round_trip_on_a_private_key() {
        let key = r"HKCU\Software\ZyroTweakRoundTrip";
        let _ = registry::delete_key(key);
        registry::write(key, "V", &Raw::dword(7)).unwrap();
        let undo = TweakUndo {
            tweak_id: "x".into(),
            regs: vec![
                RegUndo { key: key.into(), name: "V".into(), old: registry::read(key, "V"), delete_key_on_revert: false },
                RegUndo { key: key.into(), name: "New".into(), old: None, delete_key_on_revert: false },
            ],
            ..Default::default()
        };
        registry::write(key, "V", &Raw::dword(0)).unwrap();
        registry::write(key, "New", &Raw::dword(1)).unwrap();
        let entry = UndoEntry { id: "t".into(), ts: 0, module: "tweaks".into(), label: "t".into(), kind: "registry".into(), undo: Some(serde_json::to_value(&undo).unwrap()), reverted: false };
        revert_tweak(&entry).unwrap();
        assert_eq!(registry::read(key, "V").unwrap().as_dword(), Some(7));
        assert!(registry::read(key, "New").is_none());
        registry::delete_key(key).unwrap();
    }
}
