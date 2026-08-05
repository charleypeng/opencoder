// L1 tests for the pet facade (TASK-M8-07/08): typed wrappers over the
// Rust pet commands and the `pet-state` / `pet-intensity` events. Mirrors
// the events.ts no-op guard: outside Tauri every call resolves without
// touching the IPC layer (a web build has no pet window), and the
// subscriptions return no-op unlisten functions. Inside Tauri the
// invoke/listen args follow the Rust command signatures (pet_state →
// petState, etc.).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const { invokeMock, listenMock } = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return { invokeMock: vi.fn(), listenMock };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

const PET_EVENT = "pet-state";
const PET_INTENSITY_EVENT = "pet-intensity";

describe("pet facade outside Tauri", () => {
  beforeEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves no-ops for every command", async () => {
    const pet = await import("./pet.js");
    await expect(pet.showPet()).resolves.toBeUndefined();
    await expect(pet.hidePet()).resolves.toBeUndefined();
    await expect(pet.isPetVisible()).resolves.toBe(false);
    await expect(pet.setPetState("working")).resolves.toBeUndefined();
    await expect(pet.setPetIntensity(60)).resolves.toBeUndefined();
    await expect(pet.setPetIgnoreMouse(true)).resolves.toBeUndefined();
    await expect(pet.setPetSize(180)).resolves.toBeUndefined();
    await expect(pet.setPetOpacity(0.7)).resolves.toBeUndefined();
    await expect(pet.setPetTopmost(false)).resolves.toBeUndefined();
    await expect(pet.setPetMute(true)).resolves.toBeUndefined();
    await expect(pet.setPetDock(false)).resolves.toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("returns a no-op unlisten for the state subscription", async () => {
    const pet = await import("./pet.js");
    const stop = pet.subscribeToPetState(() => undefined);
    expect(typeof stop).toBe("function");
    expect(listenMock).not.toHaveBeenCalled();
    stop();
  });

  it("returns a no-op unlisten for the intensity subscription", async () => {
    const pet = await import("./pet.js");
    const stop = pet.subscribeToPetIntensity(() => undefined);
    expect(typeof stop).toBe("function");
    expect(listenMock).not.toHaveBeenCalled();
    stop();
  });
});

describe("pet facade inside Tauri", () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { mock: true };
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("invokes the show/hide/visibility commands", async () => {
    const pet = await import("./pet.js");
    invokeMock.mockResolvedValueOnce(undefined);
    await pet.showPet();
    expect(invokeMock).toHaveBeenCalledWith("pet_show");
    invokeMock.mockResolvedValueOnce(undefined);
    await pet.hidePet();
    expect(invokeMock).toHaveBeenCalledWith("pet_hide");
    invokeMock.mockResolvedValueOnce(true);
    await expect(pet.isPetVisible()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("pet_is_visible");
  });

  it("forwards a state with the camelCased command arg", async () => {
    const pet = await import("./pet.js");
    invokeMock.mockResolvedValueOnce(undefined);
    await pet.setPetState("success");
    expect(invokeMock).toHaveBeenCalledWith("pet_set_state", { petState: "success" });
  });

  it("forwards an intensity with the command arg", async () => {
    const pet = await import("./pet.js");
    invokeMock.mockResolvedValueOnce(undefined);
    await pet.setPetIntensity(80);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_intensity", { intensity: 80 });
  });

  it("guards non-integer intensities", async () => {
    const pet = await import("./pet.js");
    await pet.setPetIntensity(80.5);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes each settings command with its arg", async () => {
    const pet = await import("./pet.js");
    await pet.setPetIgnoreMouse(true);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_ignore_mouse", { ignore: true });
    await pet.setPetSize(180);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_size", { size: 180 });
    await pet.setPetOpacity(0.7);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_opacity", { opacity: 0.7 });
    await pet.setPetTopmost(false);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_topmost", { topmost: false });
    await pet.setPetMute(true);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_mute", { muted: true });
    await pet.setPetDock(false);
    expect(invokeMock).toHaveBeenCalledWith("pet_set_dock", { docked: false });
  });

  it("guards non-integer sizes", async () => {
    const pet = await import("./pet.js");
    await pet.setPetSize(180.5);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("subscribes to the pet-state event and validates payloads", async () => {
    const pet = await import("./pet.js");
    const handler: (state: string) => void = vi.fn();
    let captured: ListenHandler = () => undefined;
    listenMock.mockImplementationOnce((_event: string, cb: ListenHandler) => {
      captured = cb;
      return Promise.resolve(vi.fn());
    });
    const stop = pet.subscribeToPetState(handler);
    expect(listenMock).toHaveBeenCalledWith(PET_EVENT, expect.any(Function));
    captured({ payload: "working" });
    expect(handler).toHaveBeenCalledWith("working");
    // Unknown payloads are dropped (the union is the contract).
    captured({ payload: "exploding" });
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it("unregisters the listener on unlisten", async () => {
    const pet = await import("./pet.js");
    const unlisten = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);
    const stop = pet.subscribeToPetState(() => undefined);
    stop();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });

  it("subscribes to the pet-intensity event and validates payloads", async () => {
    const pet = await import("./pet.js");
    const handler: (intensity: number) => void = vi.fn();
    let captured: ListenHandler = () => undefined;
    listenMock.mockImplementationOnce((_event: string, cb: ListenHandler) => {
      captured = cb;
      return Promise.resolve(vi.fn());
    });
    const stop = pet.subscribeToPetIntensity(handler);
    expect(listenMock).toHaveBeenCalledWith(PET_INTENSITY_EVENT, expect.any(Function));
    captured({ payload: 42 });
    expect(handler).toHaveBeenCalledWith(42);
    // Out-of-range / non-numeric payloads are dropped.
    captured({ payload: 101 });
    captured({ payload: -1 });
    captured({ payload: "42" });
    captured({ payload: 42.5 });
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it("unregisters the intensity listener on unlisten", async () => {
    const pet = await import("./pet.js");
    const unlisten = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);
    const stop = pet.subscribeToPetIntensity(() => undefined);
    stop();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });
});
