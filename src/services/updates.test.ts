// L1 tests for the application auto-update facade (TASK-M8-09): the
// outside-Tauri no-op guard (web builds / L2 environments never touch the
// updater IPC), the check/download/relaunch call chain, the progress
// accumulation, and the once-a-day auto-check helpers (shouldAutoCheck +
// oc-updates localStorage round trip).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_CHECK_INTERVAL_MS,
  checkForUpdates,
  getAppVersion,
  installAndRelaunch,
  loadLastCheck,
  recordLastCheck,
  shouldAutoCheck,
} from "./updates.js";

const { checkMock, relaunchMock, getVersionMock, downloadAndInstallMock } = vi.hoisted(() => {
  return {
    checkMock: vi.fn(),
    relaunchMock: vi.fn(),
    getVersionMock: vi.fn(),
    downloadAndInstallMock: vi.fn(
      (onEvent?: (e: { event: string; data: Record<string, number> }) => void) => {
        if (onEvent) {
          onEvent({ event: "Started", data: { contentLength: 100 } });
          onEvent({ event: "Progress", data: { chunkLength: 30 } });
          onEvent({ event: "Progress", data: { chunkLength: 50 } });
          onEvent({ event: "Finished", data: {} });
        }
        return Promise.resolve();
      },
    ),
  };
});

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
  Update: class {
    version = "2.0.0";
    downloadAndInstall = downloadAndInstallMock;
  },
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: getVersionMock }));

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

afterEach(() => {
  vi.clearAllMocks();
  withoutTauri();
  localStorage.clear();
});

describe("getAppVersion", () => {
  it("resolves the app version inside Tauri", async () => {
    withTauri();
    getVersionMock.mockResolvedValue("0.1.0");
    await expect(getAppVersion()).resolves.toBe("0.1.0");
    expect(getVersionMock).toHaveBeenCalled();
  });

  it("resolves null outside Tauri without invoking", async () => {
    await expect(getAppVersion()).resolves.toBeNull();
    expect(getVersionMock).not.toHaveBeenCalled();
  });
});

describe("checkForUpdates", () => {
  it("delegates to the plugin check inside Tauri", async () => {
    withTauri();
    checkMock.mockResolvedValue({ version: "2.0.0" });
    const update = await checkForUpdates();
    expect(update).toEqual({ version: "2.0.0" });
    expect(checkMock).toHaveBeenCalled();
  });

  it("resolves null outside Tauri without invoking", async () => {
    await expect(checkForUpdates()).resolves.toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("propagates plugin failures to the caller", async () => {
    withTauri();
    checkMock.mockRejectedValue(new Error("endpoint unreachable"));
    await expect(checkForUpdates()).rejects.toThrow("endpoint unreachable");
  });
});

describe("installAndRelaunch", () => {
  it("downloads, reports accumulated progress and relaunches", async () => {
    withTauri();
    const progress: { downloaded: number; total?: number; fraction?: number }[] = [];
    const updateLike = {
      downloadAndInstall: downloadAndInstallMock,
    } as never;
    await installAndRelaunch(updateLike, (next) => progress.push(next));
    expect(progress).toEqual([
      { downloaded: 0, total: 100, fraction: 0 },
      { downloaded: 30, total: 100, fraction: 0.3 },
      { downloaded: 80, total: 100, fraction: 0.8 },
      // Finished: the final snapshot lands the UI on a full 100% bar.
      { downloaded: 80, total: 100, fraction: 1 },
    ]);
    expect(relaunchMock).toHaveBeenCalled();
  });

  it("is a no-op outside Tauri", async () => {
    await installAndRelaunch({} as never, () => {});
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("does not relaunch when the download fails", async () => {
    withTauri();
    downloadAndInstallMock.mockRejectedValueOnce(new Error("download failed"));
    const updateLike = { downloadAndInstall: downloadAndInstallMock } as never;
    await expect(installAndRelaunch(updateLike, () => {})).rejects.toThrow("download failed");
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});

describe("shouldAutoCheck", () => {
  it("runs when no check was ever recorded", () => {
    expect(shouldAutoCheck(undefined, 1_000_000)).toBe(true);
  });

  it("runs when the stored timestamp is malformed", () => {
    expect(shouldAutoCheck(Number.NaN, 1_000_000)).toBe(true);
  });

  it("skips within the daily window", () => {
    const now = 2_000_000;
    expect(shouldAutoCheck(now - 1_000, now)).toBe(false);
    expect(shouldAutoCheck(now - AUTO_CHECK_INTERVAL_MS + 1, now)).toBe(false);
  });

  it("runs again after the daily window elapsed", () => {
    const now = 2_000_000;
    expect(shouldAutoCheck(now - AUTO_CHECK_INTERVAL_MS, now)).toBe(true);
    expect(shouldAutoCheck(now - AUTO_CHECK_INTERVAL_MS - 60_000, now)).toBe(true);
  });
});

describe("oc-updates persistence", () => {
  it("records and reloads the last check timestamp", () => {
    expect(loadLastCheck()).toBeUndefined();
    recordLastCheck(123456);
    expect(loadLastCheck()).toBe(123456);
  });

  it("drops malformed payloads", () => {
    localStorage.setItem("oc-updates", "not json");
    expect(loadLastCheck()).toBeUndefined();
    localStorage.setItem("oc-updates", JSON.stringify({ lastCheck: "soon" }));
    expect(loadLastCheck()).toBeUndefined();
    localStorage.setItem("oc-updates", JSON.stringify({ lastCheck: null }));
    expect(loadLastCheck()).toBeUndefined();
  });

  it("tolerates storage failures", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => recordLastCheck(1)).not.toThrow();
    setItem.mockRestore();
  });
});
