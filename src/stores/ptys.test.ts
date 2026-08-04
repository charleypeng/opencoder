// L1 tests for the PTY store (TASK-M6-01): list application, upsert, exit
// marking, removal and per-server reset.

import { afterEach, describe, expect, it } from "vitest";
import type { Pty } from "../services/pty.js";
import {
  applyPtyList,
  EMPTY_SERVER_PTY_STATE,
  getServerPtyState,
  markPtyExited,
  ptys,
  removePty,
  resetServer,
  upsertPty,
} from "./ptys.js";

const SERVER = "srv-pty";

function pty(id: string, overrides: Partial<Pty> = {}): Pty {
  return {
    id,
    title: id,
    command: "sh",
    args: [],
    cwd: "/mock/projects/opencode-demo",
    status: "running",
    pid: 1000,
    ...overrides,
  } as Pty;
}

afterEach(() => {
  resetServer(SERVER);
});

describe("ptys store", () => {
  it("starts empty and reads fall back to the empty bucket", () => {
    expect(getServerPtyState(SERVER)).toBe(EMPTY_SERVER_PTY_STATE);
    expect(getServerPtyState(SERVER).order).toEqual([]);
  });

  it("applyPtyList replaces the whole list and order", () => {
    applyPtyList(SERVER, [pty("pty_1"), pty("pty_2")]);
    expect(ptys[SERVER].order).toEqual(["pty_1", "pty_2"]);
    expect(ptys[SERVER].ptys["pty_1"].pid).toBe(1000);

    // A refresh drops ids absent from the new list.
    applyPtyList(SERVER, [pty("pty_2"), pty("pty_3")]);
    expect(ptys[SERVER].order).toEqual(["pty_2", "pty_3"]);
    expect(ptys[SERVER].ptys["pty_1"]).toBeUndefined();
  });

  it("upsertPty inserts and updates without duplicating order", () => {
    upsertPty(SERVER, pty("pty_1"));
    upsertPty(SERVER, pty("pty_2"));
    upsertPty(SERVER, pty("pty_1", { title: "renamed" }));
    expect(ptys[SERVER].order).toEqual(["pty_1", "pty_2"]);
    expect(ptys[SERVER].ptys["pty_1"].title).toBe("renamed");
  });

  it("markPtyExited sets status and exitCode", () => {
    upsertPty(SERVER, pty("pty_1"));
    markPtyExited(SERVER, "pty_1", 0);
    expect(ptys[SERVER].ptys["pty_1"]).toMatchObject({ status: "exited", exitCode: 0 });
  });

  it("markPtyExited without an exitCode only flips the status", () => {
    upsertPty(SERVER, pty("pty_1"));
    markPtyExited(SERVER, "pty_1");
    expect(ptys[SERVER].ptys["pty_1"].status).toBe("exited");
    expect(ptys[SERVER].ptys["pty_1"].exitCode).toBeUndefined();
  });

  it("markPtyExited for an unknown id is a no-op", () => {
    markPtyExited(SERVER, "pty_nope", 1);
    // Like the session store, an update still materializes the server's
    // bucket (empty): the unknown id simply leaves nothing behind.
    expect(getServerPtyState(SERVER).order).toEqual([]);
    expect(getServerPtyState(SERVER).ptys).toEqual({});
  });

  it("removePty drops the entry and its order slot", () => {
    applyPtyList(SERVER, [pty("pty_1"), pty("pty_2"), pty("pty_3")]);
    removePty(SERVER, "pty_2");
    expect(ptys[SERVER].order).toEqual(["pty_1", "pty_3"]);
    expect(ptys[SERVER].ptys["pty_2"]).toBeUndefined();
  });

  it("removePty for an unknown id is a no-op", () => {
    applyPtyList(SERVER, [pty("pty_1")]);
    removePty(SERVER, "pty_nope");
    expect(ptys[SERVER].order).toEqual(["pty_1"]);
    expect(ptys[SERVER].ptys["pty_nope"]).toBeUndefined();
  });

  it("resetServer clears the per-server bucket only", () => {
    applyPtyList(SERVER, [pty("pty_1")]);
    applyPtyList("srv-other", [pty("other_1")]);
    resetServer(SERVER);
    expect(ptys[SERVER]).toBeUndefined();
    expect(ptys["srv-other"].order).toEqual(["other_1"]);
  });
});
