// L2 tests for the desktop settings section: close-to-tray and the global
// summon accelerator load their current values from Rust, apply changes
// immediately, persist successful changes and surface failures inline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import DesktopSection from "./DesktopSection";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

beforeEach(() => {
  withTauri();
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_close_to_tray") return Promise.resolve(false);
    if (cmd === "get_global_shortcut") return Promise.resolve("Alt+Space");
    if (cmd === "pet_get_ignore_mouse") return Promise.resolve(false);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  withoutTauri();
  localStorage.clear();
});

describe("DesktopSection", () => {
  it("renders the current values from Rust", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_close_to_tray") return Promise.resolve(true);
      if (cmd === "get_global_shortcut") return Promise.resolve("Ctrl+Shift+O");
      return Promise.resolve(undefined);
    });
    render(() => <DesktopSection />);
    await waitFor(() =>
      expect(screen.getByTestId("desktop-shortcut-input")).toHaveValue("Ctrl+Shift+O"),
    );
    expect(screen.getByTestId("desktop-close-to-tray")).toHaveAttribute("aria-checked", "true");
  });

  it("toggles close-to-tray via set_close_to_tray and persists the pref", async () => {
    render(() => <DesktopSection />);
    await waitFor(() => expect(screen.getByTestId("desktop-close-to-tray")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("desktop-close-to-tray"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_close_to_tray", { enabled: true }),
    );
    expect(screen.getByTestId("desktop-close-to-tray")).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("oc-desktop") ?? "{}").closeToTray).toBe(true);
  });

  it("keeps the switch off and shows an error when the toggle fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_close_to_tray") return Promise.resolve(false);
      if (cmd === "get_global_shortcut") return Promise.resolve("Alt+Space");
      if (cmd === "set_close_to_tray") return Promise.reject("tray unavailable");
      return Promise.resolve(undefined);
    });
    render(() => <DesktopSection />);
    await waitFor(() => expect(screen.getByTestId("desktop-close-to-tray")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("desktop-close-to-tray"));
    await waitFor(() =>
      expect(screen.getByTestId("desktop-error")).toHaveTextContent("tray unavailable"),
    );
    expect(screen.getByTestId("desktop-close-to-tray")).toHaveAttribute("aria-checked", "false");
  });

  it("saves a custom accelerator and persists it", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_close_to_tray") return Promise.resolve(false);
      if (cmd === "get_global_shortcut") return Promise.resolve("Alt+Space");
      if (cmd === "set_global_shortcut") return Promise.resolve("Ctrl+Shift+O");
      return Promise.resolve(undefined);
    });
    render(() => <DesktopSection />);
    await waitFor(() => expect(screen.getByTestId("desktop-shortcut-input")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("desktop-shortcut-input"), {
      target: { value: "Ctrl+Shift+O" },
    });
    fireEvent.click(screen.getByTestId("desktop-shortcut-save"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_global_shortcut", {
        accelerator: "Ctrl+Shift+O",
      }),
    );
    expect(JSON.parse(localStorage.getItem("oc-desktop") ?? "{}").globalShortcut).toBe(
      "Ctrl+Shift+O",
    );
    expect(screen.getByTestId("desktop-shortcut-input")).toHaveValue("Ctrl+Shift+O");
  });

  it("shows the validation error inline when the accelerator is rejected", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_close_to_tray") return Promise.resolve(false);
      if (cmd === "get_global_shortcut") return Promise.resolve("Alt+Space");
      if (cmd === "set_global_shortcut") return Promise.reject("invalid accelerator: Space");
      return Promise.resolve(undefined);
    });
    render(() => <DesktopSection />);
    await waitFor(() => expect(screen.getByTestId("desktop-shortcut-input")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("desktop-shortcut-input"), {
      target: { value: "Space" },
    });
    fireEvent.click(screen.getByTestId("desktop-shortcut-save"));
    await waitFor(() =>
      expect(screen.getByTestId("desktop-error")).toHaveTextContent("invalid accelerator: Space"),
    );
    expect(screen.getByTestId("desktop-shortcut-input")).toHaveValue("Space");
  });

  it("disables the save button for an empty accelerator", async () => {
    render(() => <DesktopSection />);
    await waitFor(() => expect(screen.getByTestId("desktop-shortcut-input")).toBeInTheDocument());
    const input = screen.getByTestId("desktop-shortcut-input");
    fireEvent.input(input, { target: { value: "" } });
    expect((screen.getByTestId("desktop-shortcut-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(input, { target: { value: "Alt+Space" } });
    expect((screen.getByTestId("desktop-shortcut-save") as HTMLButtonElement).disabled).toBe(false);
  });
});
