// PTY WebSocket facade (TASK-M6-01): bridges the Rust `pty_ws_connect`
// command's Channel to byte-level callbacks, mirroring sse.ts. Binary frames
// arrive as `{ "bytes": [...] }` envelopes (JSON byte arrays — tauri 2.11's
// Channel has no raw-byte send, so the Rust side wraps frames), termination
// as `{ "type": "pty.ws.closed" }`. The connect-token fetch and ws(s) URL
// assembly happen entirely in Rust (docs/tasks/M6.md appendix).

import { Channel, invoke } from "@tauri-apps/api/core";
import type { AuthCredentials } from "./client.js";

export interface PtyWsOptions {
  directory?: string;
  auth?: AuthCredentials;
  /** Called with each received frame's bytes (terminal output). */
  onData: (bytes: ArrayBuffer) => void;
  /** Called when the connection terminated (server close or error). */
  onClose?: () => void;
}

export interface PtyWsConnection {
  connectionId: number;
  close: () => Promise<void>;
}

/** Envelope pushed by the Rust transport for one binary frame. */
interface BytesEnvelope {
  bytes: number[];
}

/** Control envelope pushed when the connection terminates. */
interface ClosedEnvelope {
  type: "pty.ws.closed";
}

function isBytesEnvelope(message: unknown): message is BytesEnvelope {
  return (
    typeof message === "object" &&
    message !== null &&
    Array.isArray((message as { bytes?: unknown }).bytes)
  );
}

function isClosedEnvelope(message: unknown): message is ClosedEnvelope {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "pty.ws.closed"
  );
}

/**
 * Opens a PTY WebSocket data channel on the server's `/pty/{id}/connect`
 * endpoint (Rust-side ticket fetch + URL assembly). Resolves the connection
 * id; `close()` terminates the connection and is idempotent.
 */
export async function ptyConnect(
  serverId: string,
  ptyId: string,
  options: PtyWsOptions,
): Promise<PtyWsConnection> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message: unknown) => {
    if (isBytesEnvelope(message)) {
      options.onData(new Uint8Array(message.bytes).buffer);
    } else if (isClosedEnvelope(message)) {
      options.onClose?.();
    }
  };
  const connectionId = await invoke<number>("pty_ws_connect", {
    serverId,
    ptyId,
    directory: options.directory,
    channel,
    auth: options.auth,
  });
  return {
    connectionId,
    close: async () => {
      await invoke("pty_ws_close", { connectionId });
    },
  };
}

/** Sends one binary frame (keystrokes / paste data) on the connection. */
export async function ptySend(connectionId: number, data: Uint8Array): Promise<void> {
  await invoke("pty_ws_send", { connectionId, data: Array.from(data) });
}
