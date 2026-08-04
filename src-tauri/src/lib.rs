// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
pub mod connections;
pub mod transport;

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
            app.manage(registry);
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
            commands::resolve_server_base_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
