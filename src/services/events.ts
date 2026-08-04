// Tauri event subscription helpers (TASK-M1-06): thin wrappers around
// `listen` following the same outside-Tauri no-op guard as the connection
// store, so the UI can subscribe without guarding the runtime itself.

import { listen } from "@tauri-apps/api/event";
import type { ServerEntry } from "./servers.js";

/**
 * Subscribes to the Rust `servers-changed` events (full entry list, emitted
 * on every registry mutation) and forwards the payload. Returns an unlisten
 * function. Outside Tauri it is a no-op.
 */
export function subscribeToServersChanged(onChange: (entries: ServerEntry[]) => void): () => void {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    return () => {};
  }
  const unlisten = listen<ServerEntry[]>("servers-changed", (event) => {
    onChange(event.payload);
  });
  return () => {
    void unlisten.then((unlisten) => unlisten());
  };
}
