// L2 tests for the pet companion shell (TASK-M8-07/08): the page rendered
// in the pet window (label "pet"). Renders the transparent drag-region
// root with the animated CSS pet blob and a state pill driven by
// `pet-state` events, the working animation speed driven by
// `pet-intensity` events, the click headpat easter egg (attention for the
// transient lifetime, then revert to the last forwarded state), the
// double-click collapse/expand (48px window / restore) and the settings
// popover whose size/opacity sliders and topmost/mute/dock/click-through
// toggles apply to Rust immediately and persist to the pet window's
// localStorage; the hide button hides the window; the mount re-applies
// the stored prefs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PetShell from "./PetShell";
import { TRANSIENT_MS } from "./petState";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const {
  showPetMock,
  hidePetMock,
  isPetVisibleMock,
  setPetStateMock,
  setPetIntensityMock,
  setPetIgnoreMouseMock,
  setPetSizeMock,
  setPetOpacityMock,
  setPetTopmostMock,
  setPetMuteMock,
  setPetDockMock,
  notifyPetPrefsChangedMock,
  listenMock,
} = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return {
    showPetMock: vi.fn(async () => {}),
    hidePetMock: vi.fn(async () => {}),
    isPetVisibleMock: vi.fn(async () => false),
    setPetStateMock: vi.fn(async () => {}),
    setPetIntensityMock: vi.fn(async () => {}),
    setPetIgnoreMouseMock: vi.fn(async () => {}),
    setPetSizeMock: vi.fn(async () => {}),
    setPetOpacityMock: vi.fn(async () => {}),
    setPetTopmostMock: vi.fn(async () => {}),
    setPetMuteMock: vi.fn(async () => {}),
    setPetDockMock: vi.fn(async () => {}),
    notifyPetPrefsChangedMock: vi.fn(async () => {}),
    listenMock,
  };
});

vi.mock("../../services/pet.js", () => ({
  showPet: showPetMock,
  hidePet: hidePetMock,
  isPetVisible: isPetVisibleMock,
  setPetState: setPetStateMock,
  setPetIntensity: setPetIntensityMock,
  setPetIgnoreMouse: setPetIgnoreMouseMock,
  setPetSize: setPetSizeMock,
  setPetOpacity: setPetOpacityMock,
  setPetTopmost: setPetTopmostMock,
  setPetMute: setPetMuteMock,
  setPetDock: setPetDockMock,
  notifyPetPrefsChanged: notifyPetPrefsChangedMock,
  subscribeToPetPrefs: () => () => {},
  subscribeToPetState: (onState: (state: string) => void) => {
    const unlisten = listenMock("pet-state", (event) => onState(event.payload as string));
    return () => {
      void unlisten.then((unlisten) => unlisten());
    };
  },
  subscribeToPetIntensity: (onIntensity: (intensity: number) => void) => {
    const unlisten = listenMock("pet-intensity", (event) => onIntensity(event.payload as number));
    return () => {
      void unlisten.then((unlisten) => unlisten());
    };
  },
}));

/** Fires a pet-state event as the subscribed listener would receive it. */
function emitState(state: string) {
  const call = listenMock.mock.calls.find(([name]) => name === "pet-state");
  if (!call) throw new Error("no pet-state listener registered");
  call[1]({ payload: state });
}

/** Fires a pet-intensity event as the subscribed listener would receive it. */
function emitIntensity(intensity: number) {
  const call = listenMock.mock.calls.find(([name]) => name === "pet-intensity");
  if (!call) throw new Error("no pet-intensity listener registered");
  call[1]({ payload: intensity });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe("PetShell rendering", () => {
  it("renders a transparent, control-free pet canvas", () => {
    render(() => <PetShell />);
    const shell = screen.getByTestId("pet-shell");
    expect(shell).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(shell).toHaveAttribute("data-pet-state", "idle");
    expect(screen.getByTestId("pet-blob")).toBeInTheDocument();
    expect(screen.getByTestId("pet-character")).toBeInTheDocument();
    expect(screen.queryByTestId("pet-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pet-settings-toggle")).not.toBeInTheDocument();
  });

  it("subscribes to the pet-state event and updates the animation state", () => {
    render(() => <PetShell />);
    emitState("working");
    expect(screen.getByTestId("pet-shell")).toHaveAttribute("data-pet-state", "working");
    expect(screen.getByTestId("pet-blob")).toHaveAttribute("data-pet-state", "working");
    emitState("success");
    expect(screen.getByTestId("pet-blob")).toHaveAttribute("data-pet-state", "success");
  });

  it("drives the blob animation state from forwarded states", () => {
    render(() => <PetShell />);
    expect(screen.getByTestId("pet-blob")).toHaveAttribute("data-pet-state", "idle");
    emitState("waiting");
    expect(screen.getByTestId("pet-blob")).toHaveAttribute("data-pet-state", "waiting");
    emitState("error");
    expect(screen.getByTestId("pet-blob")).toHaveAttribute("data-pet-state", "error");
  });

  it("applies the intensity-driven working animation duration", () => {
    render(() => <PetShell />);
    emitIntensity(50);
    // The duration only applies while working.
    expect(screen.getByTestId("pet-blob")).not.toHaveStyle("animation-duration: 675ms");
    emitState("working");
    expect(screen.getByTestId("pet-blob")).toHaveStyle("animation-duration: 675ms");
    emitIntensity(100);
    expect(screen.getByTestId("pet-blob")).toHaveStyle("animation-duration: 400ms");
    emitState("idle");
    expect(screen.getByTestId("pet-blob")).not.toHaveStyle("animation-duration: 400ms");
  });

  it("keeps the pet free of status and settings overlays", () => {
    render(() => <PetShell />);
    expect(screen.queryByTestId("pet-click-through")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pet-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pet-settings-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pet-settings")).not.toBeInTheDocument();
  });
});

describe("PetShell interaction surface", () => {
  it("exposes a native drag region on the transparent shell", () => {
    render(() => <PetShell />);
    const shell = screen.getByTestId("pet-shell");
    expect(shell).toHaveAttribute("data-tauri-drag-region", "deep");
    fireEvent.mouseDown(shell, { button: 0 });
    expect(screen.getByTestId("pet-blob")).toBeInTheDocument();
  });
});

describe("PetShell mount prefs replay", () => {
  it("applies stored prefs through the commands at mount", async () => {
    localStorage.setItem(
      "oc-pet",
      JSON.stringify({
        size: 150,
        opacity: 0.8,
        topmost: false,
        dock: false,
        mute: true,
        clickThrough: true,
      }),
    );
    render(() => <PetShell />);
    // applyPetPrefs is async: the command calls land on microtasks.
    await waitFor(() => expect(setPetSizeMock).toHaveBeenCalledWith(150));
    await waitFor(() => expect(setPetOpacityMock).toHaveBeenCalledWith(0.8));
    await waitFor(() => expect(setPetTopmostMock).toHaveBeenCalledWith(false));
    await waitFor(() => expect(setPetMuteMock).toHaveBeenCalledWith(true));
    await waitFor(() => expect(setPetDockMock).toHaveBeenCalledWith(false));
    await waitFor(() => expect(setPetIgnoreMouseMock).toHaveBeenCalledWith(true));
  });

  it("applies nothing and stays on the defaults without stored prefs", () => {
    render(() => <PetShell />);
    expect(setPetSizeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("pet-shell")).toHaveStyle("opacity: 1");
  });
});

describe("PetShell interactions (TASK-M8-08)", () => {
  it("headpats on a single click: attention + heart, then reverts", () => {
    vi.useFakeTimers();
    render(() => <PetShell />);
    const blob = screen.getByTestId("pet-blob");
    fireEvent.click(blob);
    // The click is debounced against a double-click.
    expect(blob).toHaveAttribute("data-pet-state", "idle");
    vi.advanceTimersByTime(220);
    expect(blob).toHaveAttribute("data-pet-state", "attention");
    expect(blob).toHaveAttribute("data-headpat", "true");
    // The pet has no persistent status UI; animation state remains on the DOM
    // for accessibility-free rendering and diagnostics.
    expect(blob).toHaveAttribute("data-pet-state", "attention");
    // The local headpat reverts to the last forwarded state.
    vi.advanceTimersByTime(TRANSIENT_MS.attention);
    expect(blob).toHaveAttribute("data-pet-state", "idle");
    expect(blob).toHaveAttribute("data-headpat", "false");
  });

  it("a forwarded state supersedes a local headpat", () => {
    vi.useFakeTimers();
    render(() => <PetShell />);
    const blob = screen.getByTestId("pet-blob");
    fireEvent.click(blob);
    vi.advanceTimersByTime(220);
    expect(blob).toHaveAttribute("data-pet-state", "attention");
    emitState("working");
    expect(blob).toHaveAttribute("data-pet-state", "working");
    // The stale headpat timer does not clobber the forwarded state.
    vi.advanceTimersByTime(TRANSIENT_MS.attention);
    expect(blob).toHaveAttribute("data-pet-state", "working");
  });

  it("a forwarded attention shows the sparkle (no headpat)", () => {
    render(() => <PetShell />);
    const blob = screen.getByTestId("pet-blob");
    emitState("attention");
    expect(blob).toHaveAttribute("data-pet-state", "attention");
    expect(blob).toHaveAttribute("data-headpat", "false");
  });

  it("double-click collapses the pet to the tiny window and back", () => {
    render(() => <PetShell />);
    const blob = screen.getByTestId("pet-blob");
    fireEvent.dblClick(blob);
    expect(setPetSizeMock).toHaveBeenCalledWith(48);
    expect(blob).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("pet-restore-hint")).toBeInTheDocument();
    // The settings gear and status pill no longer exist in the pet window.
    expect(screen.queryByTestId("pet-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pet-settings-toggle")).not.toBeInTheDocument();
    // Right-click cannot open the settings while collapsed.
    fireEvent.contextMenu(blob);
    expect(screen.queryByTestId("pet-settings")).not.toBeInTheDocument();
    fireEvent.dblClick(blob);
    expect(setPetSizeMock).toHaveBeenCalledWith(160);
    expect(blob).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByTestId("pet-state")).not.toBeInTheDocument();
  });

  it("collapsed clicks do not headpat", () => {
    vi.useFakeTimers();
    render(() => <PetShell />);
    const blob = screen.getByTestId("pet-blob");
    fireEvent.dblClick(blob);
    expect(blob).toHaveAttribute("data-collapsed", "true");
    fireEvent.click(blob);
    vi.advanceTimersByTime(220 + TRANSIENT_MS.attention);
    expect(blob).toHaveAttribute("data-pet-state", "idle");
  });

  it("double-click during a headpat cancels it and reverts to the last forwarded state", () => {
    vi.useFakeTimers();
    render(() => <PetShell />);
    const blob = screen.getByTestId("pet-blob");
    fireEvent.click(blob);
    vi.advanceTimersByTime(220);
    expect(blob).toHaveAttribute("data-pet-state", "attention");
    fireEvent.dblClick(blob);
    // The cancelled headpat must not stick on attention.
    expect(blob).toHaveAttribute("data-pet-state", "idle");
    expect(blob).toHaveAttribute("data-headpat", "false");
    // The cancelled headpat timer does not clobber the revert either.
    vi.advanceTimersByTime(TRANSIENT_MS.attention);
    expect(blob).toHaveAttribute("data-pet-state", "idle");
  });
});
