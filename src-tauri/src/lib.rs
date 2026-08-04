// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
pub mod connections;
#[cfg(desktop)]
mod desktop;
pub mod discovery;
#[cfg(desktop)]
mod pet;
pub mod transport;

use connections::health::HealthMonitor;
use discovery::MdnsDiscovery;
use tauri::Manager;

// Window chrome integration (TASK-M8-04): the window-state plugin persists
// and restores the main window's size/position (and maximized flag) across
// launches; the single-instance plugin (desktop only — the crate compiles
// to an empty crate on mobile, so registration must be gated like the
// barcode-scanner plugin) forwards a second launch's focus request to the
// running instance; the macOS vibrancy path applies the macOS 26 liquid
// glass material with a Sidebar-material fallback for older systems, both
// failures swallowed so the app never fails to start over window chrome.

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_glass::init())
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    // The barcode-scanner crate is `#![cfg(mobile)]` — on desktop it compiles
    // to an empty crate, so registration must be mobile-only (TASK-M7-08);
    // the frontend facade refuses to call it on desktop. The single-instance
    // crate is the mirror image (`#![cfg(not(mobile))]`), so its registration
    // is desktop-only; the callback restores and focuses the main window on
    // a second launch.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    // Close-to-tray (TASK-M8-05): while the setting is on, closing the main
    // window hides it to the tray instead of quitting; the tray menu's Quit
    // and the app's own lifecycle stay the real exit paths.
    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let state = window.state::<desktop::DesktopState>();
            if state.close_to_tray() {
                api.prevent_close();
                let _ = window.hide();
            }
        }
    });
    builder
        .setup(|app| {
            // macOS window glass (TASK-M8-04): liquid glass on macOS 26+,
            // Sidebar material on older systems. The window-vibrancy crate
            // reports unsupported-platform-version from apply_liquid_glass
            // on old macOS; both calls are best-effort and never fatal.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_liquid_glass, apply_vibrancy, NSVisualEffectMaterial};
                if let Some(window) = app.get_webview_window("main") {
                    if apply_liquid_glass(&window, Default::default()).is_err() {
                        let _ =
                            apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None);
                    }
                }
            }
            let registry = connections::ServerRegistry::load(app.handle())?;
            let monitor = HealthMonitor::new(app.handle());
            let discovery = MdnsDiscovery::new(app.handle());
            app.manage(registry);
            app.manage(monitor);
            app.manage(discovery);
            // System tray + global summon (TASK-M8-05): desktop-only, both
            // best-effort (a missing Linux tray host or an OS-rejected
            // shortcut is logged, never fatal).
            #[cfg(desktop)]
            desktop::setup(app);
            // Pet window infrastructure (TASK-M8-07): the pet window's
            // display settings live in this managed state (defaults 160px
            // / full opacity / topmost / dock enabled); the pet window's
            // own localStorage re-applies the persisted values at mount.
            #[cfg(desktop)]
            app.manage(pet::PetState::default());
            // Start per-server health polling for every persisted server.
            let monitor = app.state::<HealthMonitor<tauri::Wry>>();
            monitor.start_all(&app.state::<connections::ServerRegistry<tauri::Wry>>());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::http_request,
            commands::http_cancel,
            commands::sse_subscribe,
            commands::sse_unsubscribe,
            commands::pty_ws_connect,
            commands::pty_ws_send,
            commands::pty_ws_close,
            commands::list_servers,
            commands::add_server,
            commands::update_server,
            commands::remove_server,
            commands::resolve_server_base_url,
            commands::get_server_health,
            commands::probe_server,
            commands::start_health_monitoring,
            commands::stop_health_monitoring,
            commands::start_mdns_discovery,
            commands::stop_mdns_discovery,
            commands::get_discovered_servers,
            #[cfg(desktop)]
            desktop::set_close_to_tray,
            #[cfg(desktop)]
            desktop::get_close_to_tray,
            #[cfg(desktop)]
            desktop::set_global_shortcut,
            #[cfg(desktop)]
            desktop::get_global_shortcut,
            #[cfg(desktop)]
            desktop::tray_set_badge,
            #[cfg(desktop)]
            pet::pet_show,
            #[cfg(desktop)]
            pet::pet_hide,
            #[cfg(desktop)]
            pet::pet_is_visible,
            #[cfg(desktop)]
            pet::pet_set_state,
            #[cfg(desktop)]
            pet::pet_set_ignore_mouse,
            #[cfg(desktop)]
            pet::pet_get_ignore_mouse,
            #[cfg(desktop)]
            pet::pet_set_size,
            #[cfg(desktop)]
            pet::pet_set_opacity,
            #[cfg(desktop)]
            pet::pet_set_topmost,
            #[cfg(desktop)]
            pet::pet_set_mute,
            #[cfg(desktop)]
            pet::pet_set_dock
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
