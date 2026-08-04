// Platform detection (TASK-M7-03): decides between the desktop and mobile
// shells from UA + WebView signals + viewport fallback (docs/architecture.md
// §3). Tauri mobile apps run in WKWebView (iOS) / Android WebView: the UA
// carries the platform ("iPhone"/"iPad"/"Android"), and `window.webkit`
// exists in WKWebView. The webkit + touch + small-viewport branch covers
// iPadOS desktop-UA mode; desktop Tauri (Wry) never reaches it because the
// desktop UA matches first and the desktop WebViews report no touch.
//
// The viewport is a LAST-RESORT fallback only: form-factor switches are
// driven by this module, never by CSS breakpoints.

export type Platform =
  | { kind: "desktop"; os: "macos" | "windows" | "linux" }
  | { kind: "mobile"; os: "ios" | "android" };

export interface DetectInput {
  /** UA string override (tests); defaults to window.navigator.userAgent. */
  userAgent?: string;
  /** `window.webkit` presence override; defaults to the live window. */
  hasWebkit?: boolean;
  /** Touch capability override; defaults to `ontouchstart in window`. */
  hasTouch?: boolean;
  /** Viewport width override; defaults to window.innerWidth. */
  viewportWidth?: number;
  /** OS reported by the Tauri OS plugin (reserved; not wired yet). */
  tauriOs?: string | null;
}

/** Largest viewport width still treated as an iPhone-form WKWebView. */
const IPHONE_FORM_MAX_PX = 1024;
/** Viewport width below which an unknown touch device is mobile. */
const TOUCH_FALLBACK_MAX_PX = 768;

function envOf(input: DetectInput): DetectInput {
  const noWindow = typeof window === "undefined";
  return {
    userAgent: input.userAgent ?? (noWindow ? "" : window.navigator.userAgent),
    hasWebkit: input.hasWebkit ?? (!noWindow && "webkit" in window),
    hasTouch: input.hasTouch ?? (!noWindow && "ontouchstart" in window),
    viewportWidth: input.viewportWidth ?? (noWindow ? 0 : window.innerWidth),
    tauriOs: input.tauriOs ?? null,
  };
}

/** Resolves the platform kind and OS from the given (or live) environment. */
export function detect(input: DetectInput = {}): Platform {
  const env = envOf(input);
  if (env.tauriOs === "ios") return { kind: "mobile", os: "ios" };
  if (env.tauriOs === "android") return { kind: "mobile", os: "android" };
  if (/iPhone|iPad|iPod/i.test(env.userAgent ?? "")) return { kind: "mobile", os: "ios" };
  if (/Android/i.test(env.userAgent ?? "")) return { kind: "mobile", os: "android" };
  // WKWebView without a mobile UA (iPadOS desktop mode): webkit + touch +
  // a phone-ish viewport is the mobile signal.
  if (
    env.hasWebkit &&
    env.hasTouch &&
    (env.viewportWidth ?? 0) > 0 &&
    (env.viewportWidth ?? 0) <= IPHONE_FORM_MAX_PX
  ) {
    return { kind: "mobile", os: "ios" };
  }
  if (/Mac OS X|Macintosh/i.test(env.userAgent ?? "")) return { kind: "desktop", os: "macos" };
  if (/Windows/i.test(env.userAgent ?? "")) return { kind: "desktop", os: "windows" };
  if (/Linux/i.test(env.userAgent ?? "")) return { kind: "desktop", os: "linux" };
  // Unknown UA: a touch-capable narrow viewport is a mobile web fallback,
  // anything else assumes a desktop Linux host.
  if (
    env.hasTouch &&
    (env.viewportWidth ?? 0) > 0 &&
    (env.viewportWidth ?? 0) <= TOUCH_FALLBACK_MAX_PX
  ) {
    return { kind: "mobile", os: "android" };
  }
  return { kind: "desktop", os: "linux" };
}

/** The current platform, resolved at module load (tests call
 *  `refreshPlatform` after stubbing the environment). */
export let platform: Platform = detect();

/** Recomputes the exported `platform` from the current environment. */
export function refreshPlatform(): Platform {
  platform = detect();
  return platform;
}
