// L1 tests for the pet state machine (TASK-M8-08): the pure reducer
// mapping coding events to the six pet states (ui-design §6) — the
// priority matrix (error > waiting_permission > working > success >
// attention > idle), the transient success/attention lifetimes and their
// expiry, the release paths (error dismiss, permission drain, completion)
// and the PetState -> animation state mapping.

import { describe, expect, it } from "vitest";
import {
  reducePetState,
  toAnimationState,
  TRANSIENT_MS,
  type PetEvent,
  type PetState,
} from "./petState";

function reduce(current: PetState, event: PetEvent): PetState {
  return reducePetState(current, event, { tokenRate: 0 });
}

const idle = { type: "session.status", status: "idle" } as const;
const busy = { type: "session.status", status: "busy" } as const;
const retry = { type: "session.status", status: "retry" } as const;
const error = { type: "session.status", status: "error" } as const;
const asked = { type: "permission.asked" } as const;
const replied = { type: "permission.replied" } as const;
const question = { type: "question.asked" } as const;
const headpat = { type: "interaction" } as const;
const expired = { type: "transient.expired" } as const;

describe("reducePetState basics", () => {
  it("stays idle on idle and ignores irrelevant events", () => {
    expect(reduce("idle", idle)).toBe("idle");
    expect(reduce("idle", replied)).toBe("idle");
    expect(reduce("idle", expired)).toBe("idle");
  });

  it("enters working on busy and retry", () => {
    expect(reduce("idle", busy)).toBe("working");
    expect(reduce("idle", retry)).toBe("working");
  });

  it("is indifferent to the tokenRate context (renderer contract)", () => {
    expect(reducePetState("idle", busy, { tokenRate: 100 })).toBe("working");
    expect(reducePetState("working", idle, { tokenRate: 0 })).toBe("success");
  });
});

describe("reducePetState completion transient", () => {
  it("shows success when a working session turns idle", () => {
    expect(reduce("working", idle)).toBe("success");
  });

  it("keeps the success transient on repeated idle re-assertions", () => {
    expect(reduce("success", idle)).toBe("success");
    expect(reduce("success", replied)).toBe("success");
  });

  it("expires to idle after the transient lifetime", () => {
    expect(reduce("success", expired)).toBe("idle");
    expect(reduce("attention", expired)).toBe("idle");
  });

  it("does not expire non-transient states", () => {
    expect(reduce("working", expired)).toBe("working");
    expect(reduce("waiting_permission", expired)).toBe("waiting_permission");
    expect(reduce("error", expired)).toBe("error");
  });
});

describe("reducePetState error handling", () => {
  it("enters error from any state", () => {
    expect(reduce("idle", error)).toBe("error");
    expect(reduce("working", error)).toBe("error");
    expect(reduce("waiting_permission", error)).toBe("error");
    expect(reduce("success", error)).toBe("error");
  });

  it("releases error on a session idle (dismiss)", () => {
    expect(reduce("error", idle)).toBe("idle");
  });

  it("releases error on a busy re-assertion (the aggregate contract: the \
watcher only reports busy when no error fact is active)", () => {
    expect(reduce("error", busy)).toBe("working");
    expect(reduce("error", retry)).toBe("working");
  });

  it("outranks a permission wait", () => {
    expect(reduce("waiting_permission", error)).toBe("error");
    expect(reduce("error", asked)).toBe("error");
  });

  it("outranks the question/headpat attention", () => {
    expect(reduce("attention", error)).toBe("error");
  });
});

describe("reducePetState permission wait", () => {
  it("enters waiting on permission.asked", () => {
    expect(reduce("idle", asked)).toBe("waiting_permission");
    expect(reduce("working", asked)).toBe("waiting_permission");
    expect(reduce("success", asked)).toBe("waiting_permission");
  });

  it("survives busy and idle re-assertions (waiting > working)", () => {
    expect(reduce("waiting_permission", busy)).toBe("waiting_permission");
    expect(reduce("waiting_permission", idle)).toBe("waiting_permission");
  });

  it("releases to idle on permission.replied", () => {
    expect(reduce("waiting_permission", replied)).toBe("idle");
  });

  it("does not touch other states on permission.replied", () => {
    expect(reduce("working", replied)).toBe("working");
    expect(reduce("success", replied)).toBe("success");
    expect(reduce("error", replied)).toBe("error");
  });

  it("outranks the question/headpat attention", () => {
    expect(reduce("attention", asked)).toBe("waiting_permission");
  });
});

describe("reducePetState attention", () => {
  it("enters attention on question.asked and interactions", () => {
    expect(reduce("idle", question)).toBe("attention");
    expect(reduce("idle", headpat)).toBe("attention");
  });

  it("does not displace higher-ranked states", () => {
    expect(reduce("working", headpat)).toBe("working");
    expect(reduce("success", question)).toBe("success");
    expect(reduce("waiting_permission", headpat)).toBe("waiting_permission");
    expect(reduce("error", question)).toBe("error");
  });

  it("is displaced by working (working > attention)", () => {
    expect(reduce("attention", busy)).toBe("working");
  });
});

describe("TRANSIENT_MS and mapping", () => {
  it("exposes the transient lifetimes", () => {
    expect(TRANSIENT_MS.success).toBe(3000);
    expect(TRANSIENT_MS.attention).toBe(5000);
  });

  it("maps PetState to the animation state union", () => {
    expect(toAnimationState("idle")).toBe("idle");
    expect(toAnimationState("working")).toBe("working");
    expect(toAnimationState("waiting_permission")).toBe("waiting");
    expect(toAnimationState("success")).toBe("success");
    expect(toAnimationState("error")).toBe("error");
    expect(toAnimationState("attention")).toBe("attention");
  });
});
