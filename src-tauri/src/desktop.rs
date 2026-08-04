// System tray, global summon shortcut and close-to-tray behaviour
// (TASK-M8-05). Desktop-only module (gated with `#[cfg(desktop)]` in
// lib.rs): the tray menu (Show/Hide, New session, Quit), the configurable
// global summon accelerator (default Alt+Space — Option+Space on macOS
// keyboards) and the pending-permission tray badge. The pure helpers
// (badge_title / is_valid_shortcut) are unit-tested here; the Tauri-bound
// wiring (tray build, menu events, shortcut handler, commands) is
// exercised through the frontend L2 tests.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default summon accelerator registered at startup; shown until the user
/// customizes it ("Option+Space" is the macOS keyboard spelling of the
/// same accelerator). Must stay in sync with DEFAULT_SUMMON_SHORTCUT in
/// src/services/tray.ts: the frontend skips re-applying the persisted
/// prefs when the stored shortcut equals this value, so a divergence
/// would silently break that skip.
pub const DEFAULT_SUMMON_SHORTCUT: &str = "Alt+Space";

/// Tray icon id; the badge command looks the tray up by it.
const TRAY_ID: &str = "main";

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

/// Builds the tray icon with its menu. The menu items (and the window
/// ops / events they trigger) live Rust-side; only "New session" talks to
/// the frontend (emits `tray-new-session`, handled by DesktopShell).
fn build_tray(app: &App) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
    let new_session = MenuItem::with_id(app, "new_session", "New session", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
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
/// global summon and single-instance reuse the same path).
fn show_main_window(app: &AppHandle) {
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

/// Tray + default summon shortcut, wired once at startup. Failures are
/// logged and swallowed so a missing tray host (some Linux DEs) or an
/// OS-rejected shortcut never blocks app startup.
pub fn setup(app: &App) {
    app.manage(DesktopState::default());
    if let Err(err) = build_tray(app) {
        eprintln!("opencoder: tray setup failed: {err}");
    }
    if let Err(err) = register_shortcut(app.handle(), DEFAULT_SUMMON_SHORTCUT) {
        eprintln!("opencoder: global shortcut setup failed: {err}");
    }
}

/// Turns the close-to-tray behaviour on or off (frontend settings toggle).
#[tauri::command]
pub fn set_close_to_tray(enabled: bool, state: State<'_, DesktopState>) {
    state.set_close_to_tray(enabled);
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
