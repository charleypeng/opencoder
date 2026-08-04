/// <reference types="vite/client" />

// Minimal surface of the Tauri IPC bridge, present only inside the WebView.
// Used to detect a non-Tauri runtime (e.g. plain-browser development).
interface Window {
  __TAURI_INTERNALS__?: Record<string, unknown>;
}
