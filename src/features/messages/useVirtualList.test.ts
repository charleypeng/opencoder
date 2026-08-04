// L1 tests for the virtual list hook (TASK-M2-09): row measurement installs
// one ResizeObserver per mounted row index and releases it when the row
// unmounts, so the observers map never retains a disconnected observer plus
// a detached DOM element for an index that is no longer rendered.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVirtualList } from "./useVirtualList";

// jsdom has no ResizeObserver; the hook only uses it when present, so the
// tests install a fake and verify the observer lifecycle through it.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  constructor() {
    FakeResizeObserver.instances.push(this);
  }
}

const { instances } = FakeResizeObserver;

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createList() {
  return createVirtualList(
    () => undefined,
    () => 3,
  );
}

describe("createVirtualList measureRow", () => {
  it("observes a mounted row and disconnects it on unmount", () => {
    const list = createList();
    const el = document.createElement("div");

    list.measureRow(1, el);
    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledWith(el);

    // Row leaves the viewport: the observer is released and no new one is
    // created for the same index.
    list.measureRow(1, undefined);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
  });

  it("replacing a row drops the old observer and observes the new element", () => {
    const list = createList();
    const first = document.createElement("div");
    const second = document.createElement("div");

    list.measureRow(0, first);
    list.measureRow(0, second);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances[1].observe).toHaveBeenCalledWith(second);
  });

  it("a row re-created after unmount gets a fresh observer", () => {
    const list = createList();
    const el = document.createElement("div");

    list.measureRow(2, el);
    list.measureRow(2, undefined);
    list.measureRow(2, el);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances[1].disconnect).not.toHaveBeenCalled();
  });
});
