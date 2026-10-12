mod cleaner;
mod ctx;
mod debloat;
mod disk;
mod duplicates;
mod fsx;
mod gamebooster;
mod model;
mod monitor;
mod processes;
mod registry;
mod safety;
mod scheduler;
mod startup;
mod system;
mod sysutil;
mod tweaks;
mod undo;
mod uninstaller;
mod updates;
mod util;

use model::Res;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

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

        ("monitor", "stats") => monitor::stats(),
        ("monitor", "info") => monitor::info(),

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
        ("system", "restorePointNeeded") => system::restore_point_needed(),
        ("system", "autoRestorePoint") => system::auto_restore_point(a_str(a, 0)),
        ("system", "listRestorePoints") => system::list_restore_points(),
        ("system", "openSystemRestore") => system::open_system_restore(),
        ("system", "openTelegram") => system::open_telegram(),
        ("system", "openGithub") => system::open_github(),

        ("history", "list") => system::history_list(),
        ("history", "revert") => system::history_revert(a_str(a, 0)),

        _ => Err(format!("Unknown API call: {module}.{method}")),
    }
}

#[tauri::command]
async fn call(module: String, method: String, args: Vec<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || dispatch(&module, &method, &args)).await.map_err(|e| e.to_string())?
}

fn show_main_window(app: &AppHandle) {
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
        .background_color(tauri::window::Color(0, 0, 0, 255))
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
                    let ids: Vec<String> = cleaner::scan_items().into_iter().filter(|i| i.needs_admin != Some(true) && i.risk == model::Risk::Safe).map(|i| i.id).collect();
                    let freed: u64 = cleaner::apply_ids(&ids, "Quick clean").iter().filter_map(|r| r.freed_bytes).sum();
                    scheduler::notify(&format!("Quick clean freed {}.", util::format_bytes(freed)));
                    ctx::emit("scheduler:ran", json!({ "freed": freed }));
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

// after "restart as admin" the old copy is still alive; wait for it or the single-instance check kills this one
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
            if !std::env::args().any(|a| a == "--hidden") {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Zyro Optimizer");

    app.run(|_app, event| {
        // stay in the tray when the last window closes
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() && ctx::minimize_to_tray() {
                api.prevent_exit();
            }
        }
    });
}
