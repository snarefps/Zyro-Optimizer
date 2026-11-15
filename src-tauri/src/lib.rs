mod apps;
mod backup;
mod cleaner;
mod ctx;
mod debloat;
mod disk;
mod dns;
mod duplicates;
mod errlog;
mod fsx;
mod gamebooster;
mod health;
mod jobs;
mod model;
mod monitor;
mod net;
mod privacy;
mod processes;
mod registry;
mod report;
mod safety;
mod scheduler;
mod shred;
mod startup;
mod system;
mod sysutil;
mod tidy;
mod tweaks;
mod undo;
mod uninstaller;
mod updates;
mod util;
mod watch;
mod winget;

use model::Res;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

fn a_str(a: &[Value], i: usize) -> String {
    a.get(i).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn a_strs(a: &[Value], i: usize) -> Vec<String> {
    a.get(i).and_then(|v| v.as_array()).map(|x| x.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}
fn a_u64(a: &[Value], i: usize, default: u64) -> u64 {
    a.get(i).and_then(|v| v.as_u64()).unwrap_or(default)
}
fn a_bool(a: &[Value], i: usize) -> bool {
    a.get(i).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn dispatch(module: &str, method: &str, a: &[Value]) -> Res<Value> {
    match (module, method) {
        ("cleaner", "scan") => cleaner::scan(),
        ("cleaner", "apply") => cleaner::apply(a_strs(a, 0)),
        ("cleaner", "details") => cleaner::details(&a_str(a, 0)),
        ("cleaner", "quick") => Ok(json!({ "freed": cleaner::quick_clean() })),

        ("startup", "scan") => startup::scan(),
        ("startup", "apply") => startup::apply(a_strs(a, 0)),
        ("startup", "enable") => startup::enable(a_strs(a, 0)),

        ("debloat", "scan") => debloat::scan(),
        ("debloat", "apply") => debloat::apply(a_strs(a, 0)),

        ("tweaks", "scan") => tweaks::scan(),
        ("tweaks", "apply") => tweaks::apply(a_strs(a, 0)),
        ("tweaks", "revert") => tweaks::revert(a_str(a, 0)),
        ("tweaks", "actionsList") => tweaks::actions_list(),
        ("tweaks", "runAction") => tweaks::run_action(a_str(a, 0)),

        ("gamebooster", "scan") => gamebooster::scan(),
        ("gamebooster", "apply") => gamebooster::apply(a_strs(a, 0)),
        ("gamebooster", "status") => gamebooster::status(),
        ("gamebooster", "restore") => gamebooster::restore(),
        ("gamebooster", "getAuto") => gamebooster::get_auto(),
        ("gamebooster", "setAuto") => gamebooster::set_auto(a_bool(a, 0), a_strs(a, 1)),
        ("gamebooster", "setRules") => gamebooster::set_rules(serde_json::from_value(a.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?),
        ("gamebooster", "checks") => gamebooster::checks(),
        ("gamebooster", "fixCheck") => gamebooster::fix_check(a_str(a, 0)),

        ("health", "boots") => health::boots(),
        ("health", "allowBootLog") => health::allow_boot_log(),
        ("health", "drives") => health::drives(),
        ("health", "battery") => health::battery(),
        ("health", "batteryReport") => health::battery_report(),

        ("net", "targets") => net::targets(),
        ("net", "ping") => net::ping(a_strs(a, 0)),
        ("net", "hostsRead") => net::hosts_read(),
        ("net", "hostsWrite") => net::hosts_write(a_str(a, 0)),

        ("tidy", "scan") => tidy::scan(),
        ("tidy", "apply") => tidy::apply(a_strs(a, 0)),

        ("shred", "inspect") => shred::inspect(a_str(a, 0)),
        ("shred", "run") => shred::run(a_strs(a, 0)),

        ("privacy", "recent") => privacy::recent(),

        ("jobs", "cancel") => jobs::cancel(),
        ("jobs", "reset") => jobs::reset(),

        ("errors", "list") => errlog::list(),
        ("errors", "clear") => errlog::clear(),

        ("uninstaller", "scan") => uninstaller::scan(),
        ("uninstaller", "apply") => uninstaller::apply(a_strs(a, 0)),
        ("uninstaller", "leftovers") => uninstaller::leftovers(a_str(a, 0)),
        ("uninstaller", "removeLeftovers") => uninstaller::remove_leftovers(a_strs(a, 0)),

        ("disk", "drives") => disk::drives(),
        ("disk", "analyze") => disk::analyze(a_str(a, 0)),
        ("disk", "largeFiles") => disk::large_files(a_str(a, 0), a_u64(a, 1, 100), a_u64(a, 2, 150) as usize),
        ("disk", "duplicates") => disk::duplicates(a_str(a, 0), a_u64(a, 1, 1)),
        ("disk", "trash") => disk::trash(a_strs(a, 0)),
        ("disk", "cancel") => disk::cancel(),
        ("disk", "reveal") => disk::reveal(a_str(a, 0)),

        ("processes", "list") => processes::list(),
        ("processes", "kill") => processes::kill(a_u64(a, 0, 0) as u32),
        ("processes", "trimMemory") => processes::trim_memory(),

        ("updates", "scan") => updates::scan(),
        ("updates", "apply") => updates::apply(a_strs(a, 0)),
        ("updates", "drivers") => updates::drivers(),
        ("updates", "openWindowsUpdate") => updates::open_windows_update(),

        ("apps", "scan") => apps::scan(),
        ("apps", "apply") => apps::apply(a_strs(a, 0)),
        ("apps", "info") => apps::info(a_str(a, 0)),
        ("apps", "download") => apps::download(a_str(a, 0)),

        ("monitor", "stats") => monitor::stats(),
        ("monitor", "info") => monitor::info(),

        ("dns", "list") => dns::list(),
        ("dns", "apply") => dns::apply(a_str(a, 0), a_str(a, 1), a_str(a, 2)),
        ("dns", "reset") => dns::reset(a_str(a, 0)),
        ("dns", "ping") => dns::ping(a_strs(a, 0)),

        ("scheduler", "getConfig") => scheduler::get_config(),
        ("scheduler", "setSchedule") => {
            let s = a.first().cloned().ok_or("Missing schedule")?;
            scheduler::set_schedule(serde_json::from_value(s).map_err(|e| e.to_string())?)
        }
        ("scheduler", "runNow") => scheduler::run_now(a_bool(a, 0)),

        ("system", "isAdmin") => Ok(json!(ctx::is_admin())),
        ("system", "version") => Ok(json!(env!("CARGO_PKG_VERSION"))),
        ("system", "createRestorePoint") => system::create_restore_point(),
        ("system", "relaunchAsAdmin") => system::relaunch_as_admin(),
        ("system", "getSettings") => system::get_settings(),
        ("system", "setSetting") => system::set_setting(a_str(a, 0), a_bool(a, 1)),
        ("system", "listRestorePoints") => system::list_restore_points(),
        ("system", "deleteRestorePoint") => system::delete_restore_point(a_u64(a, 0, 0)),
        ("system", "openSystemRestore") => system::open_system_restore(),
        ("system", "openTelegram") => system::open_telegram(),
        ("system", "openGithub") => system::open_github(),
        ("system", "setNumber") => system::set_number(a_str(a, 0), a_u64(a, 1, 0)),
        ("system", "notify") => system::notify(a_str(a, 0)),
        ("system", "logError") => system::log_error(a_str(a, 0), a_str(a, 1)),
        ("system", "installUpdate") => system::install_update(),
        ("system", "saveReport") => report::save(),
        ("system", "exportSettings") => backup::export(a.first().cloned().unwrap_or(Value::Null)),
        ("system", "listBackups") => backup::list(),
        ("system", "importBackup") => backup::import(a_str(a, 0)),
        ("system", "openBackupFolder") => backup::folder(),
        ("system", "showMain") => {
            show_main_window(ctx::ctx().app());
            Ok(Value::Null)
        }
        ("system", "checkUpdate") => system::check_update(),
        ("system", "openReleases") => system::open_releases(),

        ("history", "list") => system::history_list(),
        ("history", "revert") => system::history_revert(a_str(a, 0)),

        _ => Err(format!("Unknown API call: {module}.{method}")),
    }
}

#[tauri::command]
async fn call(module: String, method: String, args: Vec<Value>) -> Result<Value, String> {
    let result = tauri::async_runtime::spawn_blocking({
        let (module, method) = (module.clone(), method.clone());
        move || dispatch(&module, &method, &args)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(e) = &result {
        errlog::record(&format!("{module}.{method}"), e);
    }
    result
}

static LAST_QUICK_HIDE: AtomicU64 = AtomicU64::new(0);

fn place_quick(app: &AppHandle, w: &tauri::WebviewWindow) {
    let (Ok(Some(monitor)), Ok(size)) = (app.primary_monitor(), w.outer_size()) else { return };
    let area = monitor.work_area();
    let margin = (12.0 * monitor.scale_factor()) as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn toggle_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            return;
        }
        if util::now_ms().saturating_sub(LAST_QUICK_HIDE.load(Ordering::Relaxed)) < 400 {
            return;
        }
        place_quick(app, &w);
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html".into()))
        .title("Zyro Optimizer")
        .inner_size(360.0, 424.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .background_color(tauri::window::Color(32, 32, 32, 255))
        .additional_browser_args(WEBVIEW_ARGS)
        .build();
    if let Ok(w) = built {
        place_quick(app, &w);
        let handle = w.clone();
        w.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                LAST_QUICK_HIDE.store(util::now_ms(), Ordering::Relaxed);
                let _ = handle.hide();
            }
        });
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(q) = app.get_webview_window("quick") {
        let _ = q.hide();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Zyro Optimizer")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1050.0, 680.0)
        .center()
        .decorations(false)
        .shadow(true)
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(32, 32, 32, 255))
        .additional_browser_args(WEBVIEW_ARGS)
        .build();
}

const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,OptimizationHints,Translate,msEdgeSidebar --in-process-gpu --disable-gpu --enable-low-end-device-mode --renderer-process-limit=1 --disable-site-isolation-trials --disable-background-networking --disable-extensions --disable-component-update --disable-sync --disable-default-apps --disable-breakpad --disable-domain-reliability";

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Zyro Optimizer", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick clean (safe items)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &quick, &sep, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Zyro Optimizer")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            "quick" => {
                std::thread::spawn(|| {
                    let freed = cleaner::quick_clean();
                    scheduler::notify(&format!("Quick clean freed {}", util::format_bytes(freed)));
                    ctx::emit("scheduler:ran", json!({ "freed": freed }));
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => toggle_quick(tray.app_handle()),
                TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => show_main_window(tray.app_handle()),
                _ => {}
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn wait_for_previous_instance() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    let args: Vec<String> = std::env::args().collect();
    let Some(pid) = args.iter().position(|a| a == "--wait-pid").and_then(|i| args.get(i + 1)).and_then(|p| p.parse::<u32>().ok()) else { return };
    unsafe {
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let h = OpenProcess(SYNCHRONIZE, 0, pid);
        if !h.is_null() {
            WaitForSingleObject(h, 15_000);
            CloseHandle(h);
        }
    }
}

pub fn run() {
    wait_for_previous_instance();
    errlog::install_panic_hook();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .invoke_handler(tauri::generate_handler![call])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("data");
            ctx::init(app.handle().clone(), data_dir);
            build_tray(app.handle())?;
            scheduler::start();
            watch::start();
            if !std::env::args().any(|a| a == "--hidden") {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Zyro Optimizer");

    app.run(|_app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() && ctx::minimize_to_tray() {
                api.prevent_exit();
            }
        }
    });
}
