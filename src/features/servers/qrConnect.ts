// Connect-URL format for the QR code add-server flow (TASK-M7-08): the QR
// encodes `opencode://connect?url=...&name=...` (an optional `token` is
// tolerated on parse but never emitted by the desktop side). No credentials
// ever go into the payload — the desktop dialog deliberately omits the
// server's username/password. `encodeConnectUrl` builds the payload for the
// desktop QR; `parseConnectUrl` is the strict inverse used by the mobile
// scan handler to prefill the Add Server form.

import { normalizeServerUrl } from "./url";

export interface ConnectPayload {
  /** Normalized http(s) server URL. */
  url: string;
  /** Server display name (trimmed, non-empty). */
  name: string;
  /** Optional access token, kept only when the payload carries one. */
  token?: string;
}

/** Builds `opencode://connect?url=...&name=...` (never credentials). */
export function encodeConnectUrl(payload: { url: string; name: string; token?: string }): string {
  const params = new URLSearchParams({ url: payload.url, name: payload.name });
  if (payload.token) params.set("token", payload.token);
  return `opencode://connect?${params.toString()}`;
}

/**
 * Parses a scanned/pasted connect URL. Accepts only the `opencode://connect`
 * scheme+host, requires a valid http(s) `url` (scheme-less values are
 * normalized like the form does) and a non-empty `name`. Returns null for
 * anything else (random text, other schemes, missing fields, invalid URLs).
 */
export function parseConnectUrl(text: string): ConnectPayload | null {
  const trimmed = text.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "opencode:" || parsed.host !== "connect") return null;
  const rawUrl = parsed.searchParams.get("url");
  const rawName = parsed.searchParams.get("name");
  if (rawUrl === null || rawName === null) return null;
  const url = normalizeServerUrl(rawUrl);
  const name = rawName.trim();
  if (url === null || name.length === 0) return null;
  const token = parsed.searchParams.get("token");
  return { url, name, ...(token?.trim() ? { token: token.trim() } : {}) };
}
