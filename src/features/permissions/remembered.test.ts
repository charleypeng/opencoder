// L1 tests for the remember memo (TASK-M5-01): the pattern signature is
// stable under pattern reordering and distinguishes permission + pattern
// combinations, decisions are per-server, and resetRemembered clears the
// memo (per server and globally).

import { afterEach, describe, expect, it } from "vitest";
import {
  isPatternRemembered,
  permissionSignature,
  rememberPattern,
  resetRemembered,
} from "./remembered.js";

const SERVER = "srv-remember";
const OTHER = "srv-other";

afterEach(() => resetRemembered());

describe("permissionSignature", () => {
  it("is order-independent across patterns", () => {
    const a = permissionSignature({ permission: "bash", patterns: ["git status", "ls"] });
    const b = permissionSignature({ permission: "bash", patterns: ["ls", "git status"] });
    expect(a).toBe(b);
  });

  it("distinguishes permission and pattern combinations", () => {
    const bash = permissionSignature({ permission: "bash", patterns: ["ls"] });
    const edit = permissionSignature({ permission: "edit", patterns: ["ls"] });
    const otherPattern = permissionSignature({ permission: "bash", patterns: ["pnpm test"] });
    expect(bash).not.toBe(edit);
    expect(bash).not.toBe(otherPattern);
  });

  it("handles empty and missing patterns", () => {
    expect(permissionSignature({ permission: "bash", patterns: [] })).toBe(
      permissionSignature({ permission: "bash", patterns: undefined as unknown as string[] }),
    );
    expect(permissionSignature({ permission: "bash", patterns: ["ls"] })).not.toBe(
      permissionSignature({ permission: "bash", patterns: [] }),
    );
  });
});

describe("rememberPattern / isPatternRemembered", () => {
  it("remembers an answered pattern and matches reordered variants", () => {
    expect(isPatternRemembered(SERVER, { permission: "bash", patterns: ["ls"] })).toBe(false);
    rememberPattern(SERVER, { permission: "bash", patterns: ["git status", "ls"] });
    expect(
      isPatternRemembered(SERVER, { permission: "bash", patterns: ["ls", "git status"] }),
    ).toBe(true);
    expect(isPatternRemembered(SERVER, { permission: "bash", patterns: ["ls"] })).toBe(false);
  });

  it("keeps decisions isolated per server", () => {
    rememberPattern(SERVER, { permission: "bash", patterns: ["ls"] });
    expect(isPatternRemembered(OTHER, { permission: "bash", patterns: ["ls"] })).toBe(false);
    rememberPattern(OTHER, { permission: "bash", patterns: ["ls"] });
    expect(isPatternRemembered(OTHER, { permission: "bash", patterns: ["ls"] })).toBe(true);
  });

  it("resetRemembered clears one server or all servers", () => {
    rememberPattern(SERVER, { permission: "bash", patterns: ["ls"] });
    rememberPattern(OTHER, { permission: "bash", patterns: ["ls"] });
    resetRemembered(SERVER);
    expect(isPatternRemembered(SERVER, { permission: "bash", patterns: ["ls"] })).toBe(false);
    expect(isPatternRemembered(OTHER, { permission: "bash", patterns: ["ls"] })).toBe(true);
    resetRemembered();
    expect(isPatternRemembered(OTHER, { permission: "bash", patterns: ["ls"] })).toBe(false);
  });
});
