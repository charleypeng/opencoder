//! tauri-plugin-glass — iOS 26 Liquid Glass native UI bridge (TASK-M7-02
//! spike concluded PASS, tier A enabled).
//!
//! The plugin injects a native `UITabBar` into the Tauri WKWebView context
//! and bridges tab selection web <-> native; the mobile shell
//! (src/shells/mobile/) drives it (TASK-M7-03). All real work happens in
//! Swift: `ios/Sources/GlassPlugin.swift`. No Rust commands are exposed
//! yet; the bridge is Swift + JS only (documented in docs/tasks/M7.md).

use tauri::{plugin::TauriPlugin, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_glass);

/// Initializes the glass plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("glass")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            let _handle = _api.register_ios_plugin(init_plugin_glass)?;
            Ok(())
        })
        .build()
}
