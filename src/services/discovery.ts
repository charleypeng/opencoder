// Typed wrappers around the mDNS LAN discovery Tauri commands (TASK-M1-07).
// Mirrors the Rust `DiscoveredServer` shape (camelCase) and normalizes
// rejections to ApiError, following servers.ts. Every call no-ops outside
// Tauri so the UI can use the nearby-server section without guarding the
// runtime itself.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ApiError } from "./errors.js";

/** A server discovered on the LAN via mDNS (mirrors the Rust `DiscoveredServer`). */
export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
  host: string;
  port: number;
}

function isTauri(): boolean {
  return typeof window === "undefined" ? false : Boolean(window.__TAURI_INTERNALS__);
}

/** Starts the LAN mDNS scan for OpenCode servers (idempotent). */
export async function startMdnsDiscovery(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("start_mdns_discovery").catch((err: unknown) => {
    throw ApiError.fromUnknown(err);
  });
}

/** Stops the LAN mDNS scan (idempotent). */
export async function stopMdnsDiscovery(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("stop_mdns_discovery").catch((err: unknown) => {
    throw ApiError.fromUnknown(err);
  });
}

/** Servers discovered so far by the LAN mDNS scan. */
export async function getDiscoveredServers(): Promise<DiscoveredServer[]> {
  if (!isTauri()) return [];
  return invoke<DiscoveredServer[]>("get_discovered_servers").catch((err: unknown) => {
    throw ApiError.fromUnknown(err);
  });
}

/**
 * Subscribes to the Rust `server-discovered` events (one server per event,
 * already deduplicated on the Rust side) and forwards the payload. Returns
 * an unlisten function; outside Tauri it is a no-op.
 */
export function subscribeToServerDiscovered(
  onServer: (server: DiscoveredServer) => void,
): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<DiscoveredServer>("server-discovered", (event) => {
    onServer(event.payload);
  });
  return () => {
    void unlisten.then((unlisten) => unlisten());
  };
}
