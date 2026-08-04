// L1 tests for the registry store (TASK-M1-08): the active server context
// that per-server stores key off. Setting the active server id must not
// disturb other store state (e.g. connection entries for other servers).

import { afterEach, describe, expect, it } from "vitest";
import { applyServerHealth, connections } from "./connection.js";
import { getActiveServerId, registry, setActiveServer } from "./registry.js";

afterEach(() => {
  setActiveServer(null);
});

describe("registry store", () => {
  it("starts with no active server", () => {
    expect(getActiveServerId()).toBeNull();
    expect(registry.activeServerId).toBeNull();
  });

  it("sets and clears the active server id", () => {
    setActiveServer("srv-a");
    expect(getActiveServerId()).toBe("srv-a");
    setActiveServer("srv-b");
    expect(registry.activeServerId).toBe("srv-b");
    setActiveServer(null);
    expect(getActiveServerId()).toBeNull();
  });

  it("keeps connection store entries untouched when the active id changes", () => {
    applyServerHealth({ serverId: "srv-ca", healthy: true, status: "ok", failCount: 0 });
    applyServerHealth({ serverId: "srv-cb", healthy: false, status: "down", failCount: 3 });

    setActiveServer("srv-ca");
    expect(connections["srv-ca"]?.status).toBe("ok");
    expect(connections["srv-cb"]?.status).toBe("down");

    setActiveServer("srv-cb");
    expect(connections["srv-ca"]?.status).toBe("ok");
    expect(connections["srv-cb"]?.status).toBe("down");
  });
});
