// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
pub mod connections;
pub mod transport;

use connections::health::HealthMonitor;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let registry = connections::ServerRegistry::load(app.handle())?;
            let monitor = HealthMonitor::new(app.handle());
            app.manage(registry);
            app.manage(monitor);
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
            commands::list_servers,
            commands::add_server,
            commands::update_server,
            commands::remove_server,
            commands::resolve_server_base_url,
            commands::get_server_health,
            commands::probe_server,
            commands::start_health_monitoring,
            commands::stop_health_monitoring
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
