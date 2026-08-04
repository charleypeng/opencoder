// Pet companion window infrastructure (TASK-M8-07). Desktop-only module
// (gated with `#[cfg(desktop)]` in lib.rs, like desktop.rs): Rust owns the
// small transparent always-on-top "pet" WebviewWindow (label "pet", url
// /pet — the frontend route the App shell redirects to PetShell for) and
// forwards animation states sent by the main window's frontend through
// `pet-set_state`, which emits a `pet-state` event to the pet window. The
// commands here are the window plumbing only: show/hide, size / opacity /
// topmost / mute / dock / mouse-passthrough settings (applied via the pet
// window's own localStorage-persisted prefs, `applyPetPrefs` in
// src/features/pet/petPrefs.ts), the click-through toggle, and the edge
// dock listener that snaps the window flush to a screen edge when a drag
// ends within DOCK_THRESHOLD of one (multi-monitor aware through the
// monitor containing the window). The pet window is created lazily on the
// first pet_show and kept (hidden) afterwards; hide/show is idempotent.
// Click-through has an escape hatch: pet_show always re-enables pointer
// events (a click-through pet is unreachable), and the main window's
// Desktop settings host the "Pet click-through" switch that calls
// pet_set_ignore_mouse directly — so click-through can never lock the
// user out.
// Transparency needs `app.macOSPrivateApi: true` in tauri.conf.json on
// macOS (a private-API opt-in that App Store review may scrutinize — the
// app is distributed via GitHub releases, see docs/tasks/M8.md); Linux
// without a compositor falls back to an opaque rounded window (the CSS
// blob still renders, the background turns opaque — documented there).
// The pure helpers (clamp_pet_size / clamp_pet_opacity / docked_position
// / PetAnimationState serialization) are unit-tested; the Tauri-bound
// wiring (window creation, event forwarding, dock listener, commands) is
// exercised through the frontend L2 tests.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindowBuilder,
    WindowEvent,
};

/// The pet window's label (the capability file and the frontend route
/// check use the same value).
pub const PET_LABEL: &str = "pet";

/// Frontend route the pet window loads (App renders PetShell for it).
const PET_URL: &str = "/pet";

/// Default pet window edge length in physical pixels.
const DEFAULT_PET_SIZE: u32 = 160;
/// Smallest allowed pet window edge (settings slider range).
pub const MIN_PET_SIZE: u32 = 120;
/// Largest allowed pet window edge (settings slider range).
pub const MAX_PET_SIZE: u32 = 200;

/// Minimum window opacity (settings slider range).
pub const MIN_PET_OPACITY: f64 = 0.4;
/// Maximum window opacity (settings slider range).
pub const MAX_PET_OPACITY: f64 = 1.0;

/// Distance (px) from a screen edge within which a drag end snaps the
/// window flush to that edge (edge dock).
const DOCK_THRESHOLD: i32 = 30;

/// Animation states the pet frontend can be driven into (ui-design §6);
/// the main window's frontend sends them via pet_set_state and Rust
/// forwards them to the pet window as `pet-state` events. Serialized
/// lower-case so the strings match the frontend's union type verbatim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PetAnimationState {
    Idle,
    Working,
    Waiting,
    Success,
    Error,
    Attention,
}

/// Managed pet window state: creation guard, the display settings applied
/// to the window (size/opacity stored here so pet_show can recreate the
/// window with the last-applied values; the pet window's own localStorage
/// is the durable source and re-applies them at mount via the commands),
/// the click-through and edge-dock flags consulted at event time, and the
/// last forwarded animation state (re-emitted to a freshly created window
/// so it starts in the current state).
pub struct PetState {
    created: AtomicBool,
    size: AtomicU32,
    opacity: AtomicU32,
    topmost: AtomicBool,
    dock: AtomicBool,
    ignore_mouse: AtomicBool,
    muted: AtomicBool,
    last_state: Mutex<Option<PetAnimationState>>,
}

impl Default for PetState {
    fn default() -> Self {
        Self {
            created: AtomicBool::new(false),
            size: AtomicU32::new(DEFAULT_PET_SIZE),
            opacity: AtomicU32::new(100),
            topmost: AtomicBool::new(true),
            dock: AtomicBool::new(true),
            ignore_mouse: AtomicBool::new(false),
            muted: AtomicBool::new(false),
            last_state: Mutex::new(None),
        }
    }
}

impl PetState {
    fn created(&self) -> bool {
        self.created.load(Ordering::Relaxed)
    }

    fn mark_created(&self) {
        self.created.store(true, Ordering::Relaxed);
    }

    fn size(&self) -> u32 {
        self.size.load(Ordering::Relaxed)
    }

    fn set_size(&self, size: u32) {
        self.size.store(clamp_pet_size(size), Ordering::Relaxed);
    }

    fn set_opacity(&self, opacity: f64) {
        self.opacity.store(
            (clamp_pet_opacity(opacity) * 100.0).round() as u32,
            Ordering::Relaxed,
        );
    }

    fn topmost(&self) -> bool {
        self.topmost.load(Ordering::Relaxed)
    }

    fn dock(&self) -> bool {
        self.dock.load(Ordering::Relaxed)
    }

    fn ignore_mouse(&self) -> bool {
        self.ignore_mouse.load(Ordering::Relaxed)
    }

    fn last_state(&self) -> Option<PetAnimationState> {
        *self.last_state.lock().unwrap()
    }

    fn set_last_state(&self, state: PetAnimationState) {
        *self.last_state.lock().unwrap() = Some(state);
    }
}

/// Clamps a pet window edge length into the settings range.
pub fn clamp_pet_size(size: u32) -> u32 {
    size.clamp(MIN_PET_SIZE, MAX_PET_SIZE)
}

/// Clamps a pet window opacity into [0.4, 1.0], rounded to two decimals;
/// non-finite input yields the maximum (a sane default for a corrupt pref).
pub fn clamp_pet_opacity(opacity: f64) -> f64 {
    if !opacity.is_finite() {
        return MAX_PET_OPACITY;
    }
    let clamped = opacity.clamp(MIN_PET_OPACITY, MAX_PET_OPACITY);
    (clamped * 100.0).round() / 100.0
}

/// The position the window snaps to when `position` is within `threshold`
/// of an edge of the `monitor` (size) rectangle: flush left/right/top/
/// bottom. Returns None when the window is far from every edge, and the
/// snapped position (equal to the input when already flush) otherwise.
/// Multi-monitor safe: callers pass the position relative to the window's
/// own monitor, so the snap coordinates stay inside that monitor. A window
/// larger than the monitor never snaps (it can't be flush).
pub fn docked_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: PhysicalSize<u32>,
    threshold: i32,
) -> Option<PhysicalPosition<i32>> {
    let width = size.width as i32;
    let height = size.height as i32;
    let monitor_width = monitor.width as i32;
    let monitor_height = monitor.height as i32;
    if width > monitor_width || height > monitor_height {
        return None;
    }
    let mut x = position.x;
    let mut y = position.y;
    let mut changed = false;
    if position.x <= threshold {
        x = 0;
        changed = true;
    } else if position.x + width >= monitor_width - threshold {
        x = monitor_width - width;
        changed = true;
    }
    if position.y <= threshold {
        y = 0;
        changed = true;
    } else if position.y + height >= monitor_height - threshold {
        y = monitor_height - height;
        changed = true;
    }
    if !changed {
        return None;
    }
    Some(PhysicalPosition::new(x, y))
}

/// Creates the pet window (label "pet", transparent frameless always-on-
/// top small window loading the /pet route) and attaches the edge-dock
/// listener. Created invisible; the caller shows it once fully
/// configured (opacity / click-through set) so the first appearance is
/// already correct.
fn create_pet_window<R: tauri::Runtime>(app: &AppHandle<R>, state: &PetState) -> tauri::Result<()> {
    let size = state.size();
    let window = WebviewWindowBuilder::new(app, PET_LABEL, tauri::WebviewUrl::App(PET_URL.into()))
        .title("opencoder pet")
        .inner_size(size as f64, size as f64)
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .always_on_top(state.topmost())
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()?;
    // Edge dock (TASK-M8-07): while enabled, a window move ending within
    // DOCK_THRESHOLD of an edge of the window's own monitor snaps flush.
    // The snapped result is compared before setting so an already-flush
    // window never re-enters the move handler (no snap loop).
    let dock_app = app.clone();
    window.clone().on_window_event(move |event| {
        let WindowEvent::Moved(position) = event else {
            return;
        };
        let state = dock_app.state::<PetState>();
        if !state.dock() {
            return;
        }
        let Ok(Some(monitor)) = window.current_monitor() else {
            return;
        };
        let monitor_origin = monitor.position();
        // dpi positions have no arithmetic operators; offset into the
        // monitor's coordinate space so the snap stays inside it.
        let local =
            PhysicalPosition::new(position.x - monitor_origin.x, position.y - monitor_origin.y);
        let size = window.outer_size().unwrap_or_default();
        if let Some(snapped) = docked_position(local, size, *monitor.size(), DOCK_THRESHOLD) {
            let target =
                PhysicalPosition::new(snapped.x + monitor_origin.x, snapped.y + monitor_origin.y);
            if *position != target {
                let _ = window.set_position(target);
            }
        }
    });
    Ok(())
}

/// Shows the pet window, creating it on first use (with the last-applied
/// settings) and re-emitting the current animation state so a fresh
/// window starts in sync. Does not steal focus: Tauri show() keeps focus
/// where it is. Click-through is reverted on every show: a click-through
/// pet ignores all pointer events, so each show re-enables them (the
/// escape hatch — the main window's Desktop settings and the pet's own
/// settings can turn it back on).
#[tauri::command]
pub fn pet_show<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, PetState>,
) -> Result<(), String> {
    if !state.created() {
        create_pet_window(&app, &state).map_err(|err| err.to_string())?;
        state.mark_created();
    }
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        let _ = window.set_always_on_top(state.topmost());
        state.ignore_mouse.store(false, Ordering::Relaxed);
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.show();
        if let Some(last) = state.last_state() {
            let _ = app.emit_to(PET_LABEL, "pet-state", last);
        }
    }
    Ok(())
}

/// Hides the pet window (kept alive for instant re-show); idempotent.
#[tauri::command]
pub fn pet_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        let _ = window.hide();
    }
    Ok(())
}

/// Whether the pet window currently exists and is visible.
#[tauri::command]
pub fn pet_is_visible(app: AppHandle) -> bool {
    app.get_webview_window(PET_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Forwards an animation state from the main window's frontend to the pet
/// window (`pet-state` event). The state is remembered so a later
/// pet_show (first show included) re-emits it.
#[tauri::command]
pub fn pet_set_state(
    app: AppHandle,
    state: State<'_, PetState>,
    pet_state: PetAnimationState,
) -> Result<(), String> {
    state.set_last_state(pet_state);
    app.emit_to(PET_LABEL, "pet-state", pet_state)
        .map_err(|err| err.to_string())
}

/// Toggles mouse click-through on the pet window (the window keeps
/// rendering but never receives pointer events).
#[tauri::command]
pub fn pet_set_ignore_mouse(
    app: AppHandle,
    state: State<'_, PetState>,
    ignore: bool,
) -> Result<(), String> {
    state.ignore_mouse.store(ignore, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Whether the pet window currently ignores pointer events (click-
/// through); false when the window does not exist yet.
#[tauri::command]
pub fn pet_get_ignore_mouse(state: State<'_, PetState>) -> bool {
    state.ignore_mouse()
}

/// Resizes the pet window to the clamped edge length (square window).
#[tauri::command]
pub fn pet_set_size(app: AppHandle, state: State<'_, PetState>, size: u32) -> Result<(), String> {
    let size = clamp_pet_size(size);
    state.set_size(size);
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        window
            .set_size(PhysicalSize::new(size, size))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Sets the pet window opacity (clamped to [0.4, 1.0]). Tauri 2's core
/// dropped the runtime window opacity API (present in v1), so the value is
/// stored here and the pet window's frontend applies it as CSS opacity on
/// its content (PetShell reads its own localStorage; see docs/tasks/M8.md
/// for the documented deviation).
#[tauri::command]
pub fn pet_set_opacity(state: State<'_, PetState>, opacity: f64) {
    state.set_opacity(opacity);
}

/// Pins the pet window above other windows (or releases it).
#[tauri::command]
pub fn pet_set_topmost(
    app: AppHandle,
    state: State<'_, PetState>,
    topmost: bool,
) -> Result<(), String> {
    state.topmost.store(topmost, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        window
            .set_always_on_top(topmost)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Stores the pet sound mute flag (no sound exists yet — the animation
/// task M8-08 consumes this; the pet window also persists it locally).
#[tauri::command]
pub fn pet_set_mute(state: State<'_, PetState>, muted: bool) {
    state.muted.store(muted, Ordering::Relaxed);
}

/// Enables or disables the edge-dock snap listener.
#[tauri::command]
pub fn pet_set_dock(state: State<'_, PetState>, docked: bool) {
    state.dock.store(docked, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_pet_opacity, clamp_pet_size, docked_position, pet_show, PetAnimationState, PetState,
    };
    use std::sync::atomic::Ordering;
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn clamps_size_to_the_settings_range() {
        assert_eq!(clamp_pet_size(120), 120);
        assert_eq!(clamp_pet_size(160), 160);
        assert_eq!(clamp_pet_size(200), 200);
        assert_eq!(clamp_pet_size(0), 120);
        assert_eq!(clamp_pet_size(11), 120);
        assert_eq!(clamp_pet_size(999), 200);
    }

    #[test]
    fn clamps_opacity_to_the_settings_range() {
        assert_eq!(clamp_pet_opacity(1.0), 1.0);
        assert_eq!(clamp_pet_opacity(0.4), 0.4);
        assert_eq!(clamp_pet_opacity(0.0), 0.4);
        assert_eq!(clamp_pet_opacity(-3.0), 0.4);
        assert_eq!(clamp_pet_opacity(2.0), 1.0);
    }

    #[test]
    fn clamps_opacity_with_rounding_and_bad_input() {
        assert_eq!(clamp_pet_opacity(0.555), 0.56);
        assert_eq!(clamp_pet_opacity(0.7777), 0.78);
        assert_eq!(clamp_pet_opacity(f64::NAN), 1.0);
        assert_eq!(clamp_pet_opacity(f64::INFINITY), 1.0);
    }

    #[test]
    fn snaps_to_each_edge_within_the_threshold() {
        let size = PhysicalSize::new(160, 160);
        let monitor = PhysicalSize::new(1920, 1080);
        assert_eq!(
            docked_position(PhysicalPosition::new(12, 400), size, monitor, 30),
            Some(PhysicalPosition::new(0, 400))
        );
        assert_eq!(
            docked_position(PhysicalPosition::new(100, 22), size, monitor, 30),
            Some(PhysicalPosition::new(100, 0))
        );
        assert_eq!(
            docked_position(PhysicalPosition::new(1780, 400), size, monitor, 30),
            Some(PhysicalPosition::new(1760, 400))
        );
        assert_eq!(
            docked_position(PhysicalPosition::new(400, 935), size, monitor, 30),
            Some(PhysicalPosition::new(400, 920))
        );
    }

    #[test]
    fn snaps_a_corner_to_the_corner() {
        let size = PhysicalSize::new(160, 160);
        let monitor = PhysicalSize::new(1920, 1080);
        assert_eq!(
            docked_position(PhysicalPosition::new(5, 8), size, monitor, 30),
            Some(PhysicalPosition::new(0, 0))
        );
        assert_eq!(
            docked_position(PhysicalPosition::new(1900, 1060), size, monitor, 30),
            Some(PhysicalPosition::new(1760, 920))
        );
    }

    #[test]
    fn stays_put_when_far_from_edges() {
        let size = PhysicalSize::new(160, 160);
        let monitor = PhysicalSize::new(1920, 1080);
        assert_eq!(
            docked_position(PhysicalPosition::new(400, 400), size, monitor, 30),
            None
        );
        assert_eq!(
            docked_position(PhysicalPosition::new(31, 400), size, monitor, 30),
            None
        );
    }

    #[test]
    fn already_flush_positions_snap_to_themselves() {
        let size = PhysicalSize::new(160, 160);
        let monitor = PhysicalSize::new(1920, 1080);
        assert_eq!(
            docked_position(PhysicalPosition::new(0, 400), size, monitor, 30),
            Some(PhysicalPosition::new(0, 400))
        );
        assert_eq!(
            docked_position(PhysicalPosition::new(1760, 920), size, monitor, 30),
            Some(PhysicalPosition::new(1760, 920))
        );
    }

    #[test]
    fn oversized_windows_never_snap() {
        let size = PhysicalSize::new(2000, 160);
        let monitor = PhysicalSize::new(1920, 1080);
        assert_eq!(
            docked_position(PhysicalPosition::new(0, 0), size, monitor, 30),
            None
        );
    }

    #[test]
    fn state_serializes_lowercase_and_round_trips() {
        let states = [
            PetAnimationState::Idle,
            PetAnimationState::Working,
            PetAnimationState::Waiting,
            PetAnimationState::Success,
            PetAnimationState::Error,
            PetAnimationState::Attention,
        ];
        let expected = [
            "idle",
            "working",
            "waiting",
            "success",
            "error",
            "attention",
        ];
        for (state, text) in states.iter().zip(expected) {
            assert_eq!(serde_json::to_string(state).unwrap(), format!("\"{text}\""));
            assert_eq!(
                serde_json::from_str::<PetAnimationState>(&format!("\"{text}\"")).unwrap(),
                *state
            );
        }
    }

    #[test]
    fn pet_show_reverts_click_through() {
        use tauri::Manager;
        let app = tauri::test::mock_app();
        app.handle().manage(PetState::default());
        {
            let state = app.handle().state::<PetState>();
            state.ignore_mouse.store(true, Ordering::Relaxed);
            assert!(pet_show(app.handle().clone(), state).is_ok());
        }
        assert!(!app.handle().state::<PetState>().ignore_mouse());
    }
}
