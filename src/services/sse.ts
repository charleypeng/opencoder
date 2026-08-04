// SSE subscription facade (ADR-002 §4.3): creates a tauri Channel, invokes
// the Rust `sse_subscribe` command and forwards parsed events to the caller.
// Stream lifecycle (batching, filtering, reconnects, heartbeats) is owned by
// Rust; this module only bridges the Channel to the event callback.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { AuthCredentials } from "./client.js";

export interface SseEvent {
  id?: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface SseSubscriptionOptions {
  auth?: AuthCredentials;
}

export type SseUnsubscribe = () => Promise<void>;

// Envelope pushed by the Rust transport for oversized payloads: the raw JSON
// string is lazy-parsed here instead of being double-serialized.
interface RawPayload {
  __raw: string;
}

function isRawPayload(item: unknown): item is RawPayload {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as { __raw?: unknown }).__raw === "string"
  );
}

function isSseEvent(item: unknown): item is SseEvent {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as { type?: unknown }).type === "string"
  );
}

/** Normalizes one Channel message (single event or a 16ms batch array). */
function toEvents(message: unknown): SseEvent[] {
  const items = Array.isArray(message) ? message : [message];
  const events: SseEvent[] = [];
  for (const item of items) {
    if (isRawPayload(item)) {
      try {
        const parsed = JSON.parse(item.__raw) as unknown;
        if (isSseEvent(parsed)) events.push(parsed);
      } catch {
        // Malformed oversized payload: drop rather than break the stream.
      }
    } else if (isSseEvent(item)) {
      events.push(item);
    }
  }
  return events;
}

/**
 * Subscribes to a server's SSE stream. A `directory` opens
 * `/event?directory=...`; without one the global `/global/event` stream is
 * used. Returns a function that unsubscribes.
 */
export async function sseSubscribe(
  serverID: string,
  directory: string | undefined,
  onEvent: (event: SseEvent) => void,
  options: SseSubscriptionOptions = {},
): Promise<SseUnsubscribe> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message: unknown) => {
    for (const event of toEvents(message)) onEvent(event);
  };
  const subscriptionId = await invoke<number>("sse_subscribe", {
    serverId: serverID,
    directory,
    channel,
    auth: options.auth,
  });
  return async () => {
    await invoke("sse_unsubscribe", { subscriptionId });
  };
}
