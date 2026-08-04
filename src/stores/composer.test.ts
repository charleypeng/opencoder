// L1 tests for the composer prefill store (TASK-M7-10): queueing,
// blank-input rejection, newest-wins replacement and one-shot consumption.

import { afterEach, describe, expect, it } from "vitest";
import { composerPrefill, consumeComposerPrefill, prefillComposer } from "./composer";

afterEach(() => {
  consumeComposerPrefill();
});

describe("composer prefill", () => {
  it("queues a trimmed text", () => {
    prefillComposer("  hello  ");
    expect(composerPrefill()).toEqual({ text: "hello" });
  });

  it("ignores blank input", () => {
    prefillComposer("   ");
    prefillComposer("");
    expect(composerPrefill()).toBeNull();
  });

  it("keeps only the latest prefill", () => {
    prefillComposer("first");
    prefillComposer("second");
    expect(composerPrefill()).toEqual({ text: "second" });
  });

  it("consumes the prefill exactly once", () => {
    prefillComposer("hello");
    expect(composerPrefill()).not.toBeNull();
    consumeComposerPrefill();
    expect(composerPrefill()).toBeNull();
    consumeComposerPrefill();
    expect(composerPrefill()).toBeNull();
  });

  it("starts empty", () => {
    expect(composerPrefill()).toBeNull();
  });
});
