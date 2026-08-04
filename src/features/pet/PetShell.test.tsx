// L2 tests for the pet companion shell (TASK-M8-07): the page rendered in
// the pet window (label "pet"). Renders the transparent drag-region root
// with a static blob placeholder and a state pill driven by `pet-state`
// events; the gear button / right-click opens the settings popover whose
// size/opacity sliders and topmost/mute/dock/click-through toggles apply
// to Rust immediately and persist to the pet window's localStorage; the
// hide button hides the window; the mount re-applies the stored prefs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PetShell from "./PetShell";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const {
  showPetMock,
  hidePetMock,
  isPetVisibleMock,
  setPetStateMock,
  setPetIgnoreMouseMock,
  setPetSizeMock,
  setPetOpacityMock,
  setPetTopmostMock,
  setPetMuteMock,
  setPetDockMock,
  listenMock,
} = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return {
    showPetMock: vi.fn(async () => {}),
    hidePetMock: vi.fn(async () => {}),
    isPetVisibleMock: vi.fn(async () => false),
    setPetStateMock: vi.fn(async () => {}),
    setPetIgnoreMouseMock: vi.fn(async () => {}),
    setPetSizeMock: vi.fn(async () => {}),
    setPetOpacityMock: vi.fn(async () => {}),
    setPetTopmostMock: vi.fn(async () => {}),
    setPetMuteMock: vi.fn(async () => {}),
    setPetDockMock: vi.fn(async () => {}),
    listenMock,
  };
});

vi.mock("../../services/pet.js", () => ({
  showPet: showPetMock,
  hidePet: hidePetMock,
  isPetVisible: isPetVisibleMock,
  setPetState: setPetStateMock,
  setPetIgnoreMouse: setPetIgnoreMouseMock,
  setPetSize: setPetSizeMock,
  setPetOpacity: setPetOpacityMock,
  setPetTopmost: setPetTopmostMock,
  setPetMute: setPetMuteMock,
  setPetDock: setPetDockMock,
  subscribeToPetState: (onState: (state: string) => void) => {
    const unlisten = listenMock("pet-state", (event) => onState(event.payload as string));
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PetShell rendering", () => {
  it("renders the drag region, the blob and the idle state pill", () => {
    render(() => <PetShell />);
    const shell = screen.getByTestId("pet-shell");
    expect(shell).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(shell).toHaveAttribute("data-pet-state", "idle");
    expect(screen.getByTestId("pet-blob")).toBeInTheDocument();
    expect(screen.getByTestId("pet-state")).toHaveTextContent("Idle");
  });

  it("subscribes to the pet-state event and updates the pill", () => {
    render(() => <PetShell />);
    emitState("working");
    expect(screen.getByTestId("pet-shell")).toHaveAttribute("data-pet-state", "working");
    expect(screen.getByTestId("pet-state")).toHaveTextContent("Working");
    emitState("success");
    expect(screen.getByTestId("pet-state")).toHaveTextContent("Success");
  });

  it("shows the click-through marker only while enabled", () => {
    render(() => <PetShell />);
    expect(screen.queryByTestId("pet-click-through")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    fireEvent.click(screen.getByTestId("pet-click-through-toggle"));
    expect(screen.getByTestId("pet-click-through")).toBeInTheDocument();
  });
});

describe("PetShell settings", () => {
  it("opens the popover from the gear button and from right-click", () => {
    render(() => <PetShell />);
    expect(screen.queryByTestId("pet-settings")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    expect(screen.getByTestId("pet-settings")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    expect(screen.queryByTestId("pet-settings")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId("pet-blob"));
    expect(screen.getByTestId("pet-settings")).toBeInTheDocument();
  });

  it("applies and persists the size slider", () => {
    render(() => <PetShell />);
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    fireEvent.input(screen.getByTestId("pet-size-slider"), { target: { value: "180" } });
    expect(setPetSizeMock).toHaveBeenCalledWith(180);
    expect(JSON.parse(localStorage.getItem("oc-pet") ?? "{}")).toEqual({ size: 180 });
  });

  it("applies and persists the opacity slider", () => {
    render(() => <PetShell />);
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    fireEvent.input(screen.getByTestId("pet-opacity-slider"), { target: { value: "0.7" } });
    expect(setPetOpacityMock).toHaveBeenCalledWith(0.7);
    expect(JSON.parse(localStorage.getItem("oc-pet") ?? "{}")).toEqual({ opacity: 0.7 });
  });

  it("applies and persists each toggle", () => {
    render(() => <PetShell />);
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    fireEvent.click(screen.getByTestId("pet-topmost-toggle"));
    expect(setPetTopmostMock).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId("pet-mute-toggle"));
    expect(setPetMuteMock).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("pet-dock-toggle"));
    expect(setPetDockMock).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId("pet-click-through-toggle"));
    expect(setPetIgnoreMouseMock).toHaveBeenCalledWith(true);
    expect(JSON.parse(localStorage.getItem("oc-pet") ?? "{}")).toEqual({
      topmost: false,
      mute: true,
      dock: false,
      clickThrough: true,
    });
  });

  it("hides the pet window from the hide button", () => {
    render(() => <PetShell />);
    fireEvent.click(screen.getByTestId("pet-settings-toggle"));
    fireEvent.click(screen.getByTestId("pet-hide"));
    expect(hidePetMock).toHaveBeenCalled();
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
