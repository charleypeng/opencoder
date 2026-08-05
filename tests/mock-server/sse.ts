import type { Request, Response } from "express";
import { scenarios } from "./scenarios/index.js";

// SSE endpoint handler (docs/testing.md §2.2).
//
// Always streams `server.connected` first, then replays the scenario
// timeline (`?scenario=`, default happy-chat for /event, global-events for
// /global/event). `: ping` comment frames every 5s keep the connection alive
// through proxies that idle inactive streams. All timers are cleared when
// the client disconnects.

export interface SSEOptions {
  // true for /global/event: streams GlobalEvent envelopes and a
  // server.connected without a directory.
  global: boolean;
}

const HEARTBEAT_MS = 5_000;

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function handleSSE(req: Request, res: Response, options: SSEOptions): void {
  const directory = firstQueryValue(req.query["directory"]);
  const scenarioName =
    firstQueryValue(req.query["scenario"]) ?? (options.global ? "global-events" : "happy-chat");
  const dropAfter = firstQueryValue(req.query["__drop"]) === "true";
  // `?syncDelay=<ms>` (mock extension, see docs/api-coverage.md §5): holds
  // the whole timeline back so client-side re-sync work (which the
  // server.connected event triggers) settles BEFORE the scenario events
  // start playing. Without it, events at t=0 race the client's
  // snapshot fetch and the re-sync's wholesale list replace wipes them
  // (observed by the M10 E2E suite). Tests enable it via the shim URL.
  const syncDelay = Number(firstQueryValue(req.query["syncDelay"]));
  const delayMs = Number.isFinite(syncDelay) && syncDelay > 0 ? syncDelay : 0;

  const timeline = scenarios[scenarioName];
  if (!timeline) {
    res.status(400).json({ error: `unknown scenario: ${scenarioName}` });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let ended = false;
  const endStream = (): void => {
    if (ended) return;
    ended = true;
    res.end();
  };

  const connected: Record<string, unknown> = {
    id: "evt_connected_0001",
    type: "server.connected",
    properties: options.global
      ? { reconnected: false }
      : { ...(directory !== undefined ? { directory } : {}), reconnected: false },
  };
  writeEvent(res, connected);

  // `?__drop=true` replays only the first scenario event, then closes the
  // connection mid-stream (no terminal event) — reconnect tests on any
  // scenario. The sse-drop scenario encodes the same behavior in the
  // timeline itself.
  const play = dropAfter ? timeline.slice(0, 1) : timeline;
  const timers: NodeJS.Timeout[] = [];
  for (const entry of play) {
    timers.push(
      setTimeout(() => {
        if (ended) return;
        if (entry.drop) {
          endStream();
        } else if (entry.event !== undefined) {
          writeEvent(res, entry.event);
        }
      }, entry.at + delayMs),
    );
  }
  if (dropAfter && play.length > 0) {
    timers.push(setTimeout(endStream, play[play.length - 1].at + delayMs + 400));
  }

  const heartbeat = setInterval(() => {
    if (!ended) res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  res.on("close", () => {
    for (const timer of timers) clearTimeout(timer);
    clearInterval(heartbeat);
  });
}

function writeEvent(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
