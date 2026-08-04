// L2 tests for the desktop TitleBar (TASK-M8-04): the window chrome above
// every desktop screen. macOS renders the traffic-light spacer with NO
// custom buttons (native decorations + Overlay titleBarStyle, configured
// per-platform in src-tauri/tauri.macos.conf.json); Windows/Linux render
// the custom minimize / maximize / close buttons wired to the Tauri window
// API; outside Tauri (web build) the bar renders inert with no controls.
// The drag region is the `data-tauri-drag-region="deep"` attribute — the
// script Tauri injects into the webview owns BOTH window dragging and
// double-click maximize natively (internal_toggle_maximize, cancellable
// mouseup zoom on macOS), so the component itself wires no dblclick
// handler; the attribute presence is the contract under test here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import TitleBar from "./TitleBar";
import { refreshPlatform } from "../../platform/index.js";

const { isTauriMock, getCurrentWindowMock, showPetMock, hidePetMock, isPetVisibleMock } =
  vi.hoisted(() => ({
    isTauriMock: vi.fn<() => boolean>(() => false),
    getCurrentWindowMock: vi.fn(),
    showPetMock: vi.fn(async () => {}),
    hidePetMock: vi.fn(async () => {}),
    isPetVisibleMock: vi.fn(async () => false),
  }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: isTauriMock }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: getCurrentWindowMock }));
vi.mock("../../services/pet.js", () => ({
  showPet: showPetMock,
  hidePet: hidePetMock,
  isPetVisible: isPetVisibleMock,
}));

const ORIGINAL_UA = window.navigator.userAgent;

type WindowApiMock = {
  isMaximized: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  onResized: ReturnType<typeof vi.fn<() => Promise<() => void>>>;
  minimize: ReturnType<typeof vi.fn<() => Promise<void>>>;
  toggleMaximize: ReturnType<typeof vi.fn<() => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

/** A fake Tauri Window object mirroring the API surface the bar uses. */
function fakeWindow(overrides: Partial<WindowApiMock> = {}): {
  win: WindowApiMock;
  unlisten: ReturnType<typeof vi.fn>;
} {
  const unlisten = vi.fn();
  return {
    unlisten,
    win: {
      isMaximized: vi.fn<() => Promise<boolean>>(async () => false),
      onResized: vi.fn<() => Promise<() => void>>(async () => unlisten),
      minimize: vi.fn<() => Promise<void>>(async () => {}),
      toggleMaximize: vi.fn<() => Promise<void>>(async () => {}),
      close: vi.fn<() => Promise<void>>(async () => {}),
      ...overrides,
    },
  };
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  refreshPlatform();
}

beforeEach(() => {
  isTauriMock.mockReturnValue(false);
  getCurrentWindowMock.mockReset();
  showPetMock.mockClear();
  hidePetMock.mockClear();
  isPetVisibleMock.mockClear();
  isPetVisibleMock.mockResolvedValue(false);
});

afterEach(() => {
  setUserAgent(ORIGINAL_UA);
});

describe("TitleBar web (non-Tauri)", () => {
  it("renders the drag region and title without window controls", () => {
    render(() => <TitleBar />);
    const bar = screen.getByTestId("titlebar");
    expect(bar).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(screen.getByTestId("titlebar-title")).toHaveTextContent("opencoder");
    expect(screen.queryByTestId("titlebar-minimize")).not.toBeInTheDocument();
    expect(screen.queryByTestId("titlebar-maximize")).not.toBeInTheDocument();
    expect(screen.queryByTestId("titlebar-close")).not.toBeInTheDocument();
    expect(getCurrentWindowMock).not.toHaveBeenCalled();
  });
});

describe("TitleBar macOS", () => {
  it("reserves the traffic-light space and renders no custom buttons", async () => {
    isTauriMock.mockReturnValue(true);
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { win, unlisten } = fakeWindow();
    getCurrentWindowMock.mockReturnValue(win);

    render(() => <TitleBar />);
    const bar = screen.getByTestId("titlebar");
    expect(bar).toHaveAttribute("data-window-controls", "mac");
    expect(bar.className).toContain("pl-[78px]");
    expect(screen.queryByTestId("titlebar-minimize")).not.toBeInTheDocument();
    expect(screen.queryByTestId("titlebar-maximize")).not.toBeInTheDocument();
    expect(screen.queryByTestId("titlebar-close")).not.toBeInTheDocument();

    expect(getCurrentWindowMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(win.isMaximized).toHaveBeenCalled());
    expect(win.onResized).toHaveBeenCalled();
    // The resize listener is torn down on unmount (microtasks flushed so
    // the async onResized registration has run). The first render stays
    // mounted, so its unlisten must NOT have fired yet.
    expect(unlisten).not.toHaveBeenCalled();
    const second = fakeWindow();
    getCurrentWindowMock.mockReturnValue(second.win);
    const { unmount } = render(() => <TitleBar />);
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    expect(second.unlisten).toHaveBeenCalled();
  });
});

describe("TitleBar Windows / Linux custom controls", () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  });

  it("renders min/max/close buttons that drive the window API", async () => {
    const { win } = fakeWindow();
    getCurrentWindowMock.mockReturnValue(win);

    render(() => <TitleBar />);
    const bar = screen.getByTestId("titlebar");
    expect(bar).toHaveAttribute("data-window-controls", "custom");
    expect(bar.className).not.toContain("pl-[78px]");
    await vi.waitFor(() => expect(win.isMaximized).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("titlebar-minimize"));
    expect(win.minimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("titlebar-close"));
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it("toggles maximize and swaps the icon to Restore", async () => {
    const { win } = fakeWindow();
    win.isMaximized.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getCurrentWindowMock.mockReturnValue(win);

    render(() => <TitleBar />);
    await vi.waitFor(() => expect(win.isMaximized).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("titlebar-maximize")).toHaveAttribute("aria-label", "Maximize");

    fireEvent.click(screen.getByTestId("titlebar-maximize"));
    expect(win.toggleMaximize).toHaveBeenCalledTimes(1);
    // The post-toggle query flips the icon to the restore variant.
    await vi.waitFor(() =>
      expect(screen.getByTestId("titlebar-maximize")).toHaveAttribute("aria-label", "Restore"),
    );
  });
});

describe("TitleBar Linux", () => {
  it("renders custom controls like Windows (jsdom default UA)", async () => {
    isTauriMock.mockReturnValue(true);
    setUserAgent(ORIGINAL_UA);
    const { win } = fakeWindow();
    getCurrentWindowMock.mockReturnValue(win);

    render(() => <TitleBar />);
    expect(screen.getByTestId("titlebar")).toHaveAttribute("data-window-controls", "custom");
    expect(screen.getByTestId("titlebar-minimize")).toBeInTheDocument();
    expect(screen.getByTestId("titlebar-maximize")).toBeInTheDocument();
    expect(screen.getByTestId("titlebar-close")).toBeInTheDocument();
  });
});

describe("TitleBar pet toggle (TASK-M8-07)", () => {
  it("renders the pet button on every platform and summons the pet", async () => {
    render(() => <TitleBar />);
    const button = screen.getByTestId("titlebar-pet");
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    await waitFor(() => expect(showPetMock).toHaveBeenCalledTimes(1));
    expect(hidePetMock).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
  });

  it("mirrors the pet's actual visibility at mount", async () => {
    isTauriMock.mockReturnValue(true);
    setUserAgent(ORIGINAL_UA);
    const { win } = fakeWindow();
    getCurrentWindowMock.mockReturnValue(win);
    isPetVisibleMock.mockResolvedValue(true);
    render(() => <TitleBar />);
    await vi.waitFor(() => expect(isPetVisibleMock).toHaveBeenCalled());
    expect(screen.getByTestId("titlebar-pet")).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the pet when already visible", async () => {
    isTauriMock.mockReturnValue(true);
    setUserAgent(ORIGINAL_UA);
    const { win } = fakeWindow();
    getCurrentWindowMock.mockReturnValue(win);
    isPetVisibleMock.mockResolvedValue(true);
    render(() => <TitleBar />);
    await vi.waitFor(() => expect(isPetVisibleMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("titlebar-pet"));
    await waitFor(() => expect(hidePetMock).toHaveBeenCalledTimes(1));
    expect(showPetMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("titlebar-pet")).toHaveAttribute("aria-pressed", "false"),
    );
  });

  it("keeps the pet button on macOS (no custom window controls)", async () => {
    isTauriMock.mockReturnValue(true);
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { win } = fakeWindow();
    getCurrentWindowMock.mockReturnValue(win);
    render(() => <TitleBar />);
    expect(screen.getByTestId("titlebar-pet")).toBeInTheDocument();
    expect(screen.queryByTestId("titlebar-minimize")).not.toBeInTheDocument();
  });
});
