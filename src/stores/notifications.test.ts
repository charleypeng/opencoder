// L1 tests for the notification preferences store (TASK-M8-06):
// persistence round trips, malformed-payload resilience, field-shape
// validation and the absent-fields-mean-ON semantics of the toggles.

import { afterEach, describe, expect, it } from "vitest";
import {
  loadNotificationPrefs,
  notificationsEnabled,
  saveNotificationPrefs,
  serverNotificationsEnabled,
  setNotificationsEnabled,
  setServerNotificationsEnabled,
} from "./notifications.js";

afterEach(() => {
  localStorage.removeItem("oc-notifications");
});

describe("persistence", () => {
  it("round-trips the prefs through localStorage", () => {
    saveNotificationPrefs({ enabled: false, perServer: { "srv-a": true } });
    expect(loadNotificationPrefs()).toEqual({ enabled: false, perServer: { "srv-a": true } });
  });

  it("yields {} when nothing is stored", () => {
    expect(loadNotificationPrefs()).toEqual({});
  });

  it("yields {} for malformed payloads", () => {
    localStorage.setItem("oc-notifications", "not json{{");
    expect(loadNotificationPrefs()).toEqual({});
    localStorage.setItem("oc-notifications", "42");
    expect(loadNotificationPrefs()).toEqual({});
  });

  it("validates field shapes and drops the rest", () => {
    localStorage.setItem(
      "oc-notifications",
      JSON.stringify({
        enabled: "yes",
        perServer: { "srv-a": false, "srv-b": "no", nested: { x: true } },
        junk: 1,
      }),
    );
    expect(loadNotificationPrefs()).toEqual({ perServer: { "srv-a": false } });
  });
});

describe("toggles", () => {
  it("defaults to enabled when absent", () => {
    expect(notificationsEnabled({})).toBe(true);
    expect(serverNotificationsEnabled("srv-a", {})).toBe(true);
    expect(notificationsEnabled()).toBe(true);
    expect(serverNotificationsEnabled("srv-a")).toBe(true);
  });

  it("reads the explicit master switch", () => {
    expect(notificationsEnabled({ enabled: true })).toBe(true);
    expect(notificationsEnabled({ enabled: false })).toBe(false);
  });

  it("reads the explicit per-server switch independently", () => {
    const prefs = { perServer: { "srv-a": false, "srv-b": true } };
    expect(serverNotificationsEnabled("srv-a", prefs)).toBe(false);
    expect(serverNotificationsEnabled("srv-b", prefs)).toBe(true);
    expect(serverNotificationsEnabled("srv-c", prefs)).toBe(true);
  });

  it("setNotificationsEnabled persists the master switch", () => {
    setNotificationsEnabled(false);
    expect(loadNotificationPrefs()).toEqual({ enabled: false });
    expect(notificationsEnabled()).toBe(false);
    setNotificationsEnabled(true);
    expect(loadNotificationPrefs()).toEqual({ enabled: true });
    expect(notificationsEnabled()).toBe(true);
  });

  it("setServerNotificationsEnabled merges into the per-server map", () => {
    setServerNotificationsEnabled("srv-a", false);
    setServerNotificationsEnabled("srv-b", true);
    expect(loadNotificationPrefs()).toEqual({ perServer: { "srv-a": false, "srv-b": true } });
    expect(serverNotificationsEnabled("srv-a")).toBe(false);
    // A later master change must not clobber the per-server map.
    setNotificationsEnabled(false);
    expect(loadNotificationPrefs()).toEqual({
      enabled: false,
      perServer: { "srv-a": false, "srv-b": true },
    });
  });
});
