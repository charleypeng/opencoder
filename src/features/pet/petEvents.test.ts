// L1 tests for the pet event wiring (TASK-M8-08): startPetWatcher derives
// the pet state from the live session/permission/question stores and the
// token rate, forwards the result through the pet facade, applies the
// transient success/attention lifetimes (3s / 5s) and stops on dispose.
// Unlike the haptics/notifications watchers, the mount snapshot IS applied
// — the pet reflects the current truth from the first flush. Tests that
// exercise the transient timers install fake timers BEFORE the watcher
// starts, so the watcher's own timers are fake too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPetWatcher } from "./petEvents";
import { TRANSIENT_MS } from "./petState";
import {
  applySessionList,
  resetServer as resetSessions,
  setSessionStatus,
} from "../../stores/session.js";
import { applyList, enqueue, resetServer as resetPermissions } from "../../stores/permission.js";
import {
  enqueue as enqueueQuestion,
  dequeue as dequeueQuestion,
  resetServer as resetQuestions,
} from "../../stores/question.js";
import { bumpTokenRate, resetTokenRate } from "./tokenRate";
import type { Session } from "../../services/session.js";
import type { PermissionRequest } from "../../services/permission.js";
import type { QuestionRequest } from "../../services/question.js";

const { setPetStateMock, setPetIntensityMock } = vi.hoisted(() => ({
  setPetStateMock: vi.fn<(state: string) => Promise<void>>(async () => {}),
  setPetIntensityMock: vi.fn<(intensity: number) => Promise<void>>(async () => {}),
}));

vi.mock("../../services/pet.js", () => ({
  setPetState: setPetStateMock,
  setPetIntensity: setPetIntensityMock,
}));

const SERVER = "srv-pet";

function session(id: string): Session {
  return {
    id,
    slug: `slug-${id}`,
    projectID: "p",
    directory: "/d",
    title: `Session ${id}`,
    agent: "build",
    model: { id: "m", providerID: "p" },
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function permission(id: string): PermissionRequest {
  return { id, sessionID: "s1", permission: "shell", patterns: [], metadata: {}, always: [] };
}

function question(id: string): QuestionRequest {
  return {
    id,
    sessionID: "s1",
    questions: [
      { question: "Pick one", header: "Pick", options: [{ label: "a", description: "a" }] },
    ],
  };
}

/** The last state forwarded through setPetState. */
function lastForwarded(): string | undefined {
  const calls = setPetStateMock.mock.calls;
  return calls.length === 0 ? undefined : calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  resetSessions(SERVER);
  resetPermissions(SERVER);
  resetQuestions(SERVER);
  resetTokenRate();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  resetSessions(SERVER);
  resetPermissions(SERVER);
  resetQuestions(SERVER);
  resetTokenRate();
});

/** Lets Solid's deferred effect flush run (real-timer environment). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startPetWatcher state derivation", () => {
  it("applies the mount snapshot (a busy session works from the first flush)", async () => {
    applySessionList(SERVER, [session("s1")]);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    const dispose = startPetWatcher(SERVER);
    await flush();
    dispose();
    expect(lastForwarded()).toBe("working");
  });

  it("follows a full coding flow: working -> success (3s) -> idle", async () => {
    vi.useFakeTimers();
    const dispose = startPetWatcher(SERVER);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("working");
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("success");
    await vi.advanceTimersByTimeAsync(3000);
    expect(lastForwarded()).toBe("idle");
    dispose();
  });

  it("shows error and releases it on dismiss", async () => {
    const dispose = startPetWatcher(SERVER);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    await flush();
    setSessionStatus(SERVER, "s1", { type: "error", message: "boom" });
    await flush();
    expect(lastForwarded()).toBe("error");
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await flush();
    expect(lastForwarded()).toBe("idle");
    dispose();
  });

  it("waits while a permission is pending even during generation", async () => {
    const dispose = startPetWatcher(SERVER);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    await flush();
    enqueue(SERVER, permission("p1"));
    await flush();
    expect(lastForwarded()).toBe("waiting");
    // The queue drains while the session is still generating: the pet
    // lands on working in ONE fold (no idle flicker in between).
    applyList(SERVER, []);
    await flush();
    expect(lastForwarded()).toBe("working");
    dispose();
  });

  it("enters attention on a question and reverts after 5s once answered", async () => {
    vi.useFakeTimers();
    const dispose = startPetWatcher(SERVER);
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("idle");
    enqueueQuestion(SERVER, question("q1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("attention");
    // A still-pending question keeps the attention alive at each expiry.
    await vi.advanceTimersByTimeAsync(5000);
    expect(lastForwarded()).toBe("attention");
    // Answering the question lets the attention expire to idle.
    dequeueQuestion(SERVER, "q1");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(lastForwarded()).toBe("idle");
    dispose();
  });

  it("dismissing an error with a question pending lands on attention", async () => {
    const dispose = startPetWatcher(SERVER);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    await flush();
    setSessionStatus(SERVER, "s1", { type: "error", message: "boom" });
    await flush();
    expect(lastForwarded()).toBe("error");
    enqueueQuestion(SERVER, question("q1"));
    await flush();
    // The question is still blocked by the displayed error.
    expect(lastForwarded()).toBe("error");
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await flush();
    // The dismiss releases the error and the pending question renders.
    expect(lastForwarded()).toBe("attention");
    dispose();
  });

  it("a question arriving during the success transient lands attention after expiry", async () => {
    vi.useFakeTimers();
    const dispose = startPetWatcher(SERVER);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("success");
    enqueueQuestion(SERVER, question("q1"));
    await vi.advanceTimersByTimeAsync(0);
    // The question is blocked by the success transient for now.
    expect(lastForwarded()).toBe("success");
    await vi.advanceTimersByTimeAsync(TRANSIENT_MS.success);
    // The expiry re-asserts the pending question instead of dumping to idle.
    expect(lastForwarded()).toBe("attention");
    dispose();
  });

  it("a new generation cuts a transient short", async () => {
    vi.useFakeTimers();
    const dispose = startPetWatcher(SERVER);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("success");
    setSessionStatus(SERVER, "s1", { type: "busy" });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastForwarded()).toBe("working");
    await vi.advanceTimersByTimeAsync(4000);
    // The stale success timer did not revert the working state.
    expect(lastForwarded()).toBe("working");
    dispose();
  });

  it("forwards the working intensity from the token rate", async () => {
    const dispose = startPetWatcher(SERVER);
    await flush();
    bumpTokenRate();
    bumpTokenRate();
    bumpTokenRate();
    bumpTokenRate();
    bumpTokenRate();
    await flush();
    expect(setPetIntensityMock).toHaveBeenCalledWith(20);
    // A steady rate does not spam the channel: the same value is not
    // re-forwarded on the next flush.
    setPetIntensityMock.mockClear();
    await flush();
    expect(setPetIntensityMock).not.toHaveBeenCalled();
    dispose();
  });

  it("stops reacting after dispose", async () => {
    const dispose = startPetWatcher(SERVER);
    // The mount snapshot is applied synchronously on watcher start...
    expect(lastForwarded()).toBe("idle");
    dispose();
    setSessionStatus(SERVER, "s1", { type: "busy" });
    await flush();
    // ...but nothing after dispose (a stale server must never forward).
    expect(setPetStateMock).toHaveBeenCalledTimes(1);
  });
});
