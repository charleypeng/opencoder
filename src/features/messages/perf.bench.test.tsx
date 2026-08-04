// Performance benchmarks (TASK-M2-09): CI-safe upper bounds on the streaming
// pipeline hot paths. Real 60fps rendering needs a browser and is verified
// manually (1000-part transcript, token-by-token updates); these tests
// assert that the algorithmic work stays trivially small in a jsdom
// environment with generous bounds so CI machines and debug builds never
// flake:
// - store: 1000 deltas over 1000 parts (see stores/messages.test.ts);
// - virtual list: 1000 rows x many scroll positions stays cheap and mounts
//   only a constant number of rows;
// - full MessageList: a 300-message transcript renders, and ONE delta on
//   the streaming message updates the DOM in far less than a frame budget.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { render, screen, waitFor } from "@solidjs/testing-library";
import MessageList from "./MessageList";
import type { SessionMessage } from "../../services/message";
import { applyMessageBatch, applyTextDelta, resetServer } from "../../stores/messages";
import { createVirtualList } from "./useVirtualList";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-perf";
const SESSION = "ses_perf_1";

function syntheticHistory(count: number, partsPerMessage: number): SessionMessage[] {
  const out: SessionMessage[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `msg_p${i}`;
    const parts = [];
    for (let p = 0; p < partsPerMessage; p++) {
      parts.push({
        id: `prt_p${i}_${p}`,
        sessionID: SESSION,
        messageID: id,
        type: "text" as const,
        text: `message ${i} part ${p} — a few tokens of markdown text`,
      });
    }
    out.push({
      info: {
        id,
        sessionID: SESSION,
        role: i % 2 === 1 ? "user" : "assistant",
        time: { created: i * 1000 },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
      } as SessionMessage["info"],
      parts,
    });
  }
  return out;
}

function mockClient(history: SessionMessage[]) {
  const client = {
    get: vi.fn(async () => history),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  mockClient([]);
});

afterEach(() => {
  resetServer(SERVER);
});

describe("perf benchmarks (TASK-M2-09)", () => {
  it("virtual list: 1000 rows across 1000 scroll positions stay cheap", () => {
    createRoot((dispose) => {
      const scrollEl = {
        clientHeight: 400,
        scrollTop: 0,
        scrollTo: () => undefined,
      } as unknown as HTMLDivElement;
      const list = createVirtualList(
        () => scrollEl,
        () => 1000,
        (index) => `msg-${index}`,
        {},
      );
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        scrollEl.scrollTop = i * 10;
        list.onScroll(scrollEl);
        list.rows();
      }
      const ms = performance.now() - start;
      // 1000 position updates (each recomputes prefix sums over 1000 rows)
      // must be far below the frame budget on any CI machine.
      expect(ms).toBeLessThan(250);
      expect(list.rows().length).toBeLessThan(50);
      expect(list.totalHeight()).toBe(1000 * 96);
      dispose();
    });
  });

  it("MessageList: renders a 300-message transcript (1000 parts) without jank", async () => {
    mockClient(syntheticHistory(300, 3));
    const t0 = performance.now();
    render(() => <MessageList serverId={SERVER} sessionId={SESSION} />);
    const scroll = screen.getByTestId("message-list-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 0, writable: true });
    await waitFor(() => expect(screen.getByTestId("message-msg_p300")).toBeInTheDocument());
    const initialMs = performance.now() - t0;
    expect(initialMs).toBeLessThan(2000);
    // Virtualized: a 300-message transcript mounts only the visible slice.
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(40);
  });

  it("MessageList: one streaming delta updates only the streaming part, fast", async () => {
    mockClient(syntheticHistory(300, 3));
    render(() => <MessageList serverId={SERVER} sessionId={SESSION} />);
    const scroll = screen.getByTestId("message-list-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 0, writable: true });
    await waitFor(() => expect(screen.getByTestId("message-msg_p300")).toBeInTheDocument());

    const bubble = screen.getByTestId("message-msg_p300");
    const stablePart = bubble.querySelectorAll('[data-testid="markdown-text"]')[0];
    const t0 = performance.now();
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_p300",
      partID: "prt_p300_2",
      field: "text",
      delta: " streamed token",
    });
    const ms = performance.now() - t0;
    // One token lands well inside a 16ms frame budget; generous bound for CI.
    expect(ms).toBeLessThan(250);
    expect(bubble.textContent).toContain("streamed token");
    // The sibling part's DOM node is untouched (fine-grained re-render).
    expect(bubble.querySelectorAll('[data-testid="markdown-text"]')[0]).toBe(stablePart);
  });

  it("store: batched apply of 300 messages x 4 parts stays well under budget", () => {
    const items: Parameters<typeof applyMessageBatch>[2] = [];
    for (let m = 1; m <= 300; m++) {
      items.push({
        type: "message",
        info: {
          id: `msg_${m}`,
          sessionID: SESSION,
          role: "user",
          time: { created: m },
          agent: "build",
          model: { providerID: "x", modelID: "y" },
        },
      });
      for (let p = 0; p < 4; p++) {
        items.push({
          type: "part",
          part: {
            id: `prt_${m}_${p}`,
            sessionID: SESSION,
            messageID: `msg_${m}`,
            type: "text",
            text: "x",
          },
        });
      }
    }
    const t0 = performance.now();
    applyMessageBatch(SERVER, SESSION, items);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
  });
});
