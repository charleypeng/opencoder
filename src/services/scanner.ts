// Barcode scanner facade (TASK-M7-08): a thin typed wrapper over the
// official tauri-plugin-barcode-scanner guest API (crates.io + npm 2.4.5,
// plugins-workspace). The plugin is mobile-only — its Rust crate is
// `#![cfg(mobile)]` (empty on desktop) and its native side uses iOS
// AVFoundation / Android ML Kit — so the facade refuses to dispatch outside
// Tauri AND outside the mobile form factor, mirroring the haptics double
// no-op guard. `scanQrCode` is a one-shot full-screen scan that resolves
// with the decoded text; the caller owns cancellation/error UX.

import { Format, scan as pluginScan } from "@tauri-apps/plugin-barcode-scanner";
import { platform } from "../platform/index.js";

/** Whether a native camera scan can run: inside Tauri AND on mobile
 *  (the plugin is not registered on desktop, where any invoke would fail). */
export function canScan(): boolean {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) return false;
  return platform.kind === "mobile";
}

/** Runs the native camera scanner (QR codes) and resolves with the decoded
 *  text. Rejects outside Tauri/mobile and on scan errors or cancellation. */
export async function scanQrCode(): Promise<string> {
  if (!canScan()) {
    throw new Error("QR scanning is only available in the mobile app");
  }
  const scanned = await pluginScan({ formats: [Format.QRCode] });
  return scanned.content;
}
