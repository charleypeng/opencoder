// L1 tests for the server update hint store (TASK-M8-09): apply/clear
// semantics (payload validation, per-server keys, null = dismissed) and the
// reactive read surface the banner uses.

import { afterEach, describe, expect, it } from "vitest";
import {
  applyServerUpdate,
  clearServerUpdate,
  getServerUpdate,
  resetServerUpdate,
  serverUpdate,
} from "./serverUpdate.js";

const SERVER = "srv-upd";

afterEach(() => {
  resetServerUpdate(SERVER);
  resetServerUpdate("srv-other");
});

describe("applyServerUpdate", () => {
  it("stores the available version per server", () => {
    applyServerUpdate(SERVER, { version: "1.19.0" });
    expect(serverUpdate[SERVER]).toEqual({ version: "1.19.0" });
    expect(getServerUpdate(SERVER)).toEqual({ version: "1.19.0" });
  });

  it("stores the running version when known", () => {
    applyServerUpdate(SERVER, { version: "1.19.0", current: "1.18.11" });
    expect(serverUpdate[SERVER]).toEqual({ version: "1.19.0", current: "1.18.11" });
  });

  it("keeps servers independent", () => {
    applyServerUpdate(SERVER, { version: "1.19.0" });
    applyServerUpdate("srv-other", { version: "1.20.0" });
    expect(serverUpdate[SERVER]?.version).toBe("1.19.0");
    expect(serverUpdate["srv-other"]?.version).toBe("1.20.0");
  });

  it("rejects payloads without a non-empty version string", () => {
    applyServerUpdate(SERVER, { version: "" });
    expect(serverUpdate[SERVER]).toBeUndefined();
    // @ts-expect-error malformed payload shape
    applyServerUpdate(SERVER, { version: 42 });
    expect(serverUpdate[SERVER]).toBeUndefined();
    applyServerUpdate(SERVER, {} as never);
    expect(serverUpdate[SERVER]).toBeUndefined();
  });

  it("ignores non-string version on current", () => {
    applyServerUpdate(SERVER, { version: "1.19.0", current: 3 as never });
    expect(serverUpdate[SERVER]).toEqual({ version: "1.19.0" });
  });
});

describe("clearServerUpdate", () => {
  it("marks the hint as dismissed (null, not absent)", () => {
    applyServerUpdate(SERVER, { version: "1.19.0" });
    clearServerUpdate(SERVER);
    expect(serverUpdate[SERVER]).toBeNull();
    expect(getServerUpdate(SERVER)).toBeNull();
  });
});

describe("resetServerUpdate", () => {
  it("drops the hint entry entirely (fresh-again state)", () => {
    applyServerUpdate(SERVER, { version: "1.19.0" });
    clearServerUpdate(SERVER);
    resetServerUpdate(SERVER);
    expect(serverUpdate[SERVER]).toBeUndefined();
    applyServerUpdate(SERVER, { version: "1.19.0" });
    resetServerUpdate(SERVER);
    expect(serverUpdate[SERVER]).toBeUndefined();
  });
});
