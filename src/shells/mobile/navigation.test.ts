// L1 tests for the mobile navigation store (TASK-M7-03): per-tab push
// stacks, back-at-root no-op, and tab-state preservation (switching tabs
// never touches any stack — the keep-alive acceptance).

import { afterEach, describe, expect, it } from "vitest";
import {
  back,
  nav,
  push,
  resetNav,
  selectTab,
  stackOf,
  TAB_ROOT_PAGE,
  topOf,
  type Route,
} from "./navigation.js";

const CHAT: Route = { page: "chat", params: { sessionId: "sess_1" } };
const DIFF: Route = { page: "diff", params: { sessionId: "sess_1", messageID: "msg_1" } };

afterEach(() => {
  resetNav();
});

describe("mobile navigation store", () => {
  it("starts on the sessions tab with every tab rooted at its own page", () => {
    expect(nav.activeTab).toBe("sessions");
    for (const tab of ["sessions", "files", "terminal", "settings"] as const) {
      expect(stackOf(tab)).toEqual([{ page: TAB_ROOT_PAGE[tab] }]);
    }
  });

  it("pushes onto the active tab's stack and pops back", () => {
    push(CHAT);
    expect(topOf()).toEqual(CHAT);
    expect(stackOf("sessions")).toEqual([{ page: "sessions" }, CHAT]);

    push(DIFF);
    expect(topOf()).toEqual(DIFF);

    back();
    expect(topOf()).toEqual(CHAT);
    back();
    expect(topOf()).toEqual({ page: "sessions" });
  });

  it("back at the root page is a no-op", () => {
    back();
    expect(stackOf("sessions")).toEqual([{ page: "sessions" }]);
    back("files");
    expect(stackOf("files")).toEqual([{ page: "files" }]);
  });

  it("pushes to a specific tab without touching the active tab", () => {
    push({ page: "files" }, "files");
    expect(stackOf("files")).toEqual([{ page: "files" }, { page: "files" }]);
    expect(stackOf("sessions")).toEqual([{ page: "sessions" }]);
  });

  it("selectTab switches the active tab and preserves every stack", () => {
    push(CHAT);
    selectTab("terminal");
    expect(nav.activeTab).toBe("terminal");
    // Sessions stack survived the switch: tab state preserved.
    expect(stackOf("sessions")).toEqual([{ page: "sessions" }, CHAT]);
    expect(topOf("sessions")).toEqual(CHAT);

    // Back from the new tab pops ITS stack only.
    push({ page: "settings" }, "terminal");
    back();
    expect(topOf("terminal")).toEqual({ page: "terminal" });
    expect(topOf("sessions")).toEqual(CHAT);

    // Switching back lands on the previous session stack top.
    selectTab("sessions");
    expect(nav.activeTab).toBe("sessions");
    expect(topOf()).toEqual(CHAT);
  });

  it("back from a tab that is not active pops that tab's own stack", () => {
    push({ page: "settings" }, "settings");
    back("settings");
    expect(stackOf("settings")).toEqual([{ page: "settings" }]);
  });

  it("resetNav restores the initial state", () => {
    push(CHAT);
    selectTab("files");
    resetNav();
    expect(nav.activeTab).toBe("sessions");
    for (const tab of ["sessions", "files", "terminal", "settings"] as const) {
      expect(stackOf(tab)).toEqual([{ page: TAB_ROOT_PAGE[tab] }]);
    }
  });
});
