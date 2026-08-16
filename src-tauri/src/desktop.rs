// System tray, global summon shortcut and close-to-tray behaviour
// (TASK-M8-05). Desktop-only module (gated with `#[cfg(desktop)]` in
// lib.rs): the tray menu (Show/Hide, New session, Quit), the configurable
// global summon accelerator (default Alt+Space — Option+Space on macOS
// keyboards) and the pending-permission tray badge. The tray exists only
// while the close-to-tray setting is on (the frontend creates/removes it
// through `set_close_to_tray`; the startup prefs replay applies the
// persisted value at mount). The pure helpers (badge_title /
// is_valid_shortcut) are unit-tested here; the Tauri-bound wiring (tray
// build, menu events, shortcut handler, commands) is exercised through
// the frontend L2 tests.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

/// Default summon accelerator registered at startup; shown until the user
/// customizes it ("Option+Space" is the macOS keyboard spelling of the
/// same accelerator). Must stay in sync with DEFAULT_SUMMON_SHORTCUT in
/// src/services/tray.ts: the frontend skips re-applying the persisted
/// prefs when the stored shortcut equals this value, so a divergence
/// would silently break that skip.
pub const DEFAULT_SUMMON_SHORTCUT: &str = "Alt+Space";

/// Tray icon id; the badge command looks the tray up by it.
const TRAY_ID: &str = "main";

/// Store file and keys for the persisted desktop prefs (close-to-tray and
/// the summon accelerator). They live in the app store so they survive a
/// restart independent of the webview's localStorage behaviour.
const DESKTOP_STORE_PATH: &str = "desktop.json";
const KEY_CLOSE_TO_TRAY: &str = "close_to_tray";
const KEY_SUMMON_SHORTCUT: &str = "global_shortcut";

/// Managed desktop state: the close-to-tray flag and the currently
/// registered summon accelerator (initialized to the default).
pub struct DesktopState {
    close_to_tray: AtomicBool,
    summon_shortcut: Mutex<String>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(false),
            summon_shortcut: Mutex::new(DEFAULT_SUMMON_SHORTCUT.to_string()),
        }
    }
}

impl DesktopState {
    /// Whether closing the main window hides it to the tray instead.
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }

    fn set_close_to_tray(&self, enabled: bool) {
        self.close_to_tray.store(enabled, Ordering::Relaxed);
    }

    /// The accelerator currently registered for the global summon.
    fn summon_shortcut(&self) -> String {
        self.summon_shortcut.lock().unwrap().clone()
    }

    fn set_summon_shortcut(&self, accelerator: String) {
        *self.summon_shortcut.lock().unwrap() = accelerator;
    }
}

/// Badge text for the tray icon: no badge at 0, the exact count up to 9,
/// "9+" above that (a count in the tray title stays small).
pub fn badge_title(count: u32) -> Option<String> {
    match count {
        0 => None,
        1..=9 => Some(count.to_string()),
        _ => Some("9+".to_string()),
    }
}

/// Whether `accelerator` parses as a global shortcut AND carries at least
/// one modifier (a bare key would hijack normal typing app-wide).
pub fn is_valid_shortcut(accelerator: &str) -> bool {
    let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
        return false;
    };
    !shortcut.mods.is_empty()
}

/// Localized tray menu labels: follow the system locale (zh vs everything
/// else), so the tray stays readable for Chinese users without depending
/// on the webview's i18n state. The standard `LANG` environment variable
/// carries the user locale on macOS/Linux (e.g. `zh_CN.UTF-8`); Windows
/// falls back to English here.
fn tray_labels() -> (String, String, String) {
    let zh = std::env::var("LANG")
        .map(|locale| locale.starts_with("zh"))
        .unwrap_or(false);
    if zh {
        (
            "显示/隐藏".to_string(),
            "新建会话".to_string(),
            "退出".to_string(),
        )
    } else {
        (
            "Show/Hide".to_string(),
            "New session".to_string(),
            "Quit".to_string(),
        )
    }
}

/// Builds the tray icon with its menu. The menu items (and the window
/// ops / events they trigger) live Rust-side; only "New session" talks to
/// the frontend (emits `tray-new-session`, handled by DesktopShell).
/// Called when the close-to-tray setting is enabled; the tray exists only
/// while that behaviour is on.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let (show_hide_text, new_session_text, quit_text) = tray_labels();
    let show_hide = MenuItem::with_id(app, "show_hide", &show_hide_text, true, None::<&str>)?;
    let new_session = MenuItem::with_id(app, "new_session", &new_session_text, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &quit_text, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_hide, &new_session, &separator, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("opencoder")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => toggle_main_window(app),
            "new_session" => {
                let _ = app.emit("tray-new-session", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Shows, unminimizes and focuses the main window (tray Show/Hide,
/// global summon, macOS Dock reopen and single-instance reuse the same
/// path). `pub(crate)` because the app run loop (lib.rs) reuses it for
/// RunEvent::Reopen.
pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Toggles the main window's visibility (the tray menu's Show/Hide item).
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(true);
        if visible {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

/// Shared handler for the summon accelerator: bring the main window
/// forward and let the frontend react (DesktopShell no-ops today).
fn summon_handler(
    app: &AppHandle,
    _shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state == ShortcutState::Pressed {
        show_main_window(app);
        let _ = app.emit("global-summon", ());
    }
}

/// Registers `accelerator` with the summon handler; returns the error
/// string when the accelerator is invalid or the OS rejects it.
fn register_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    if !is_valid_shortcut(accelerator) {
        return Err(format!("invalid accelerator: {accelerator}"));
    }
    app.global_shortcut()
        .on_shortcut(accelerator, summon_handler)
        .map_err(|err| err.to_string())
}

/// Persists a desktop pref into the app store (best effort: storage
/// failures keep the runtime state working for the current session).
fn persist_desktop_pref(app: &AppHandle, key: &str, value: serde_json::Value) {
    let Ok(store) = app.store(DESKTOP_STORE_PATH) else {
        return;
    };
    store.set(key, value);
    let _ = store.save();
}

/// Wires the summon shortcut and the tray at startup. The persisted
/// close-to-tray flag and summon accelerator are restored from the app
/// store so a restart keeps the user's choices without depending on the
/// webview's localStorage. The tray is built here only when the persisted
/// flag is on; otherwise it is created/removed through
/// `set_close_to_tray`. Failures are logged and swallowed so an
/// OS-rejected shortcut or a missing tray host never blocks startup.
pub fn setup(app: &App) {
    app.manage(DesktopState::default());
    let handle = app.handle();
    let state = app.state::<DesktopState>();
    if let Ok(store) = handle.store(DESKTOP_STORE_PATH) {
        if let Some(serde_json::Value::Bool(enabled)) = store.get(KEY_CLOSE_TO_TRAY) {
            state.set_close_to_tray(enabled);
        }
        if let Some(serde_json::Value::String(accelerator)) = store.get(KEY_SUMMON_SHORTCUT) {
            if register_shortcut(handle, &accelerator).is_ok() {
                state.set_summon_shortcut(accelerator);
            } else {
                // A rejected persisted accelerator (now occupied by another
                // app) falls back to the default so summon still works.
                eprintln!("opencoder: persisted shortcut {accelerator} rejected, using default");
                let _ = register_shortcut(handle, DEFAULT_SUMMON_SHORTCUT);
                state.set_summon_shortcut(DEFAULT_SUMMON_SHORTCUT.to_string());
            }
        } else {
            let _ = register_shortcut(handle, DEFAULT_SUMMON_SHORTCUT);
        }
    } else {
        let _ = register_shortcut(handle, DEFAULT_SUMMON_SHORTCUT);
    }
    if state.close_to_tray() {
        if let Err(err) = build_tray(handle) {
            eprintln!("opencoder: tray setup failed: {err}");
        }
    }
}

/// Removes the tray icon when it exists (close-to-tray turned off).
fn remove_tray(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// Turns the close-to-tray behaviour on or off (frontend settings toggle).
/// The tray follows the flag: enabled builds it (so the window has a
/// Show/Hide home after it is hidden), disabled removes it. The flag is
/// persisted to the app store so it survives a restart.
#[tauri::command]
pub fn set_close_to_tray(enabled: bool, app: AppHandle, state: State<'_, DesktopState>) {
    state.set_close_to_tray(enabled);
    persist_desktop_pref(&app, KEY_CLOSE_TO_TRAY, json!(enabled));
    if enabled {
        if app.tray_by_id(TRAY_ID).is_none() {
            if let Err(err) = build_tray(&app) {
                eprintln!("opencoder: tray setup failed: {err}");
            }
        }
    } else {
        remove_tray(&app);
    }
}

/// Current close-to-tray flag.
#[tauri::command]
pub fn get_close_to_tray(state: State<'_, DesktopState>) -> bool {
    state.close_to_tray()
}

/// Replaces the summon accelerator: validates, registers the new one and
/// unregisters the previous (best effort — the new registration must
/// succeed first, so a rejected accelerator leaves the old one active).
/// Returns the applied accelerator string.
#[tauri::command]
pub fn set_global_shortcut(
    accelerator: String,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    if !is_valid_shortcut(&accelerator) {
        return Err(format!("invalid accelerator: {accelerator}"));
    }
    let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
        return Err(format!("invalid accelerator: {accelerator}"));
    };
    let current = state.summon_shortcut();
    let same = current
        .parse::<Shortcut>()
        .map(|current| current.id() == shortcut.id())
        .unwrap_or(false);
    if !same {
        app.global_shortcut()
            .on_shortcut(shortcut, summon_handler)
            .map_err(|err| err.to_string())?;
        if let Ok(previous) = current.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(previous);
        }
    }
    state.set_summon_shortcut(accelerator.clone());
    persist_desktop_pref(&app, KEY_SUMMON_SHORTCUT, json!(accelerator));
    Ok(accelerator)
}

/// The accelerator currently registered for the global summon.
#[tauri::command]
pub fn get_global_shortcut(state: State<'_, DesktopState>) -> String {
    state.summon_shortcut()
}

/// Pushes the pending-permission count onto the tray icon: macOS renders
/// it as a badge, Linux as title text next to the icon where the DE
/// supports it, Windows ignores titles (tray-crate no-op). Best effort.
#[tauri::command]
pub fn tray_set_badge(count: u32, app: AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(badge_title(count));
    }
}

#[cfg(test)]
mod tests {
    use super::{badge_title, is_valid_shortcut};

    #[test]
    fn badge_title_hides_zero() {
        assert_eq!(badge_title(0), None);
    }

    #[test]
    fn badge_title_shows_single_digit_counts() {
        assert_eq!(badge_title(1), Some("1".to_string()));
        assert_eq!(badge_title(9), Some("9".to_string()));
    }

    #[test]
    fn badge_title_caps_above_nine() {
        assert_eq!(badge_title(10), Some("9+".to_string()));
        assert_eq!(badge_title(1000), Some("9+".to_string()));
    }

    #[test]
    fn valid_shortcut_accepts_modifier_combos() {
        assert!(is_valid_shortcut("Alt+Space"));
        assert!(is_valid_shortcut("Option+Space"));
        assert!(is_valid_shortcut("Ctrl+Shift+P"));
        assert!(is_valid_shortcut("Cmd+Alt+O"));
    }

    #[test]
    fn valid_shortcut_rejects_bare_and_broken_strings() {
        assert!(!is_valid_shortcut(""));
        assert!(!is_valid_shortcut("Alt"));
        assert!(!is_valid_shortcut("Space"));
        assert!(!is_valid_shortcut("Alt+Space+Ctrl"));
        assert!(!is_valid_shortcut("Bogus+Space"));
        assert!(!is_valid_shortcut("Alt++Space"));
    }
}
