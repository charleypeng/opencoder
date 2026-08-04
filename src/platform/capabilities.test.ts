// L1 tests for the platform capability table (TASK-M7-03): desktop-only
// features stay off on mobile, native glass is iOS-only, system back is
// Android-only.

import { describe, expect, it } from "vitest";
import { capabilitiesOf } from "./capabilities.js";
import type { Platform } from "./index.js";

const DESKTOP: Platform = { kind: "desktop", os: "macos" };
const IOS: Platform = { kind: "mobile", os: "ios" };
const ANDROID: Platform = { kind: "mobile", os: "android" };

describe("platform capabilities", () => {
  it("enables desktop-only features on desktop", () => {
    const caps = capabilitiesOf(DESKTOP);
    expect(caps.supportsPet).toBe(true);
    expect(caps.supportsGlobalShortcut).toBe(true);
    expect(caps.supportsTray).toBe(true);
    expect(caps.supportsNativeGlass).toBe(false);
    expect(caps.supportsSystemBack).toBe(false);
  });

  it("disables desktop-only features on iOS and enables native glass", () => {
    const caps = capabilitiesOf(IOS);
    expect(caps.supportsPet).toBe(false);
    expect(caps.supportsGlobalShortcut).toBe(false);
    expect(caps.supportsTray).toBe(false);
    expect(caps.supportsNativeGlass).toBe(true);
    expect(caps.supportsSystemBack).toBe(false);
  });

  it("disables native glass on Android and enables system back", () => {
    const caps = capabilitiesOf(ANDROID);
    expect(caps.supportsPet).toBe(false);
    expect(caps.supportsNativeGlass).toBe(false);
    expect(caps.supportsSystemBack).toBe(true);
  });
});
