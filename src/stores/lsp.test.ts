// L1 tests for the LSP store (TASK-M9-07): apply/replace semantics for
// the per-server status lists, the version bump (lsp.updated refresh
// signal) and the reset discipline used by the SSE re-sync.

import { beforeEach, describe, expect, it } from "vitest";
import { applyFormatters, applyLsp, bumpLspVersion, getLspState, lsp, resetServer } from "./lsp.js";

const SERVER = "srv-lsp";

beforeEach(() => {
  resetServer(SERVER);
});

describe("lsp store", () => {
  it("starts empty: no bucket until the first apply", () => {
    expect(getLspState(SERVER)).toEqual({
      lsp: [],
      formatters: [],
      version: 0,
      loaded: false,
      formattersLoaded: false,
    });
  });

  it("applyLsp replaces the status list and marks the server loaded", () => {
    applyLsp(SERVER, [{ id: "lsp_1", name: "ts", root: "/x", status: "connected" }]);
    expect(getLspState(SERVER).lsp).toEqual([
      { id: "lsp_1", name: "ts", root: "/x", status: "connected" },
    ]);
    expect(getLspState(SERVER).loaded).toBe(true);
    expect(getLspState(SERVER).version).toBe(0);

    // A second fetch replaces the whole list (fresh response objects).
    applyLsp(SERVER, [
      { id: "lsp_2", name: "go", root: "/y", status: "error" },
      { id: "lsp_3", name: "py", root: "/z", status: "connected" },
    ]);
    expect(getLspState(SERVER).lsp.map((entry) => entry.id)).toEqual(["lsp_2", "lsp_3"]);
  });

  it("applyFormatters replaces the formatter list and marks it loaded", () => {
    applyFormatters(SERVER, [{ name: "biome", extensions: ["ts"], enabled: true }]);
    expect(getLspState(SERVER).formatters).toEqual([
      { name: "biome", extensions: ["ts"], enabled: true },
    ]);
    expect(getLspState(SERVER).formattersLoaded).toBe(true);
    expect(getLspState(SERVER).loaded).toBe(false);
  });

  it("bumpLspVersion increments the version without touching the lists", () => {
    applyLsp(SERVER, [{ id: "lsp_1", name: "ts", root: "/x", status: "connected" }]);
    const before = getLspState(SERVER);
    bumpLspVersion(SERVER);
    const after = getLspState(SERVER);
    expect(after.version).toBe(before.version + 1);
    expect(after.lsp).toEqual(before.lsp);
    expect(after.loaded).toBe(true);
  });

  it("bumpLspVersion works before any fetch (event-only buckets)", () => {
    bumpLspVersion(SERVER);
    expect(getLspState(SERVER).version).toBe(1);
    bumpLspVersion(SERVER);
    expect(getLspState(SERVER).version).toBe(2);
  });

  it("tracks servers independently", () => {
    applyLsp(SERVER, [{ id: "lsp_1", name: "ts", root: "/x", status: "connected" }]);
    bumpLspVersion("srv-other");
    expect(getLspState(SERVER).version).toBe(0);
    expect(getLspState("srv-other").version).toBe(1);
  });

  it("resetServer drops the bucket so the chips refetch after a re-sync", () => {
    applyLsp(SERVER, [{ id: "lsp_1", name: "ts", root: "/x", status: "connected" }]);
    applyFormatters(SERVER, [{ name: "biome", extensions: ["ts"], enabled: true }]);
    bumpLspVersion(SERVER);
    resetServer(SERVER);
    expect(lsp[SERVER]).toBeUndefined();
    expect(getLspState(SERVER).loaded).toBe(false);
    expect(getLspState(SERVER).formattersLoaded).toBe(false);
    expect(getLspState(SERVER).version).toBe(0);
  });
});
