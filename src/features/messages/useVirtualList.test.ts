// L1 tests for the virtual list hook (TASK-M2-09 / M3-05): row measurement
// installs one ResizeObserver per mounted row identity and releases it when
// the row unmounts, so the observers map never retains a disconnected
// observer plus a detached DOM element for a row that is no longer rendered.
// Measurement is keyed by ROW IDENTITY (the getRowKey accessor), so rows
// prepended by history pagination start at the estimate while the rows that
// shift down keep their measured heights — the re-anchor delta stays exact.

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
    (index) => `row-${index}`,
  );
}

describe("createVirtualList measureRow", () => {
  it("observes a mounted row and disconnects it on unmount", () => {
    const list = createList();
    const el = document.createElement("div");

    list.measureRow("row-1", el);
    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledWith(el);

    // Row leaves the viewport: the observer is released and no new one is
    // created for the same identity.
    list.measureRow("row-1", undefined);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
  });

  it("replacing a row drops the old observer and observes the new element", () => {
    const list = createList();
    const first = document.createElement("div");
    const second = document.createElement("div");

    list.measureRow("row-0", first);
    list.measureRow("row-0", second);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances[1].observe).toHaveBeenCalledWith(second);
  });

  it("a row re-created after unmount gets a fresh observer", () => {
    const list = createList();
    const el = document.createElement("div");

    list.measureRow("row-2", el);
    list.measureRow("row-2", undefined);
    list.measureRow("row-2", el);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances[1].disconnect).not.toHaveBeenCalled();
  });
});

describe("createVirtualList prepend re-anchoring (TASK-M3-05)", () => {
  // A fake layout: jsdom offsetHeight is always 0, so the test stubs a real
  // height per mounted row element to drive measurement like a browser. The
  // element is attached so the measureRow isConnected guard passes.
  const measuredEls: HTMLElement[] = [];
  afterEach(() => {
    for (const el of measuredEls) el.remove();
    measuredEls.length = 0;
  });

  function measure(list: ReturnType<typeof createVirtualList>, key: string, height: number) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    measuredEls.push(el);
    Object.defineProperty(el, "offsetHeight", { configurable: true, value: height });
    list.measureRow(key, el);
  }

  it("keeps per-row heights when rows are prepended, so the re-anchor delta is exact", async () => {
    let count = 3;
    const keys = ["a", "b", "c"];
    const list = createVirtualList(
      () => undefined,
      () => count,
      (index) => keys[index],
      { estimate: 96 },
    );

    // All rows are measured with distinct real heights (as in a browser).
    measure(list, "a", 100);
    measure(list, "b", 120);
    measure(list, "c", 140);
    await Promise.resolve(); // flush the microtask that applies measurements
    expect(list.totalHeight()).toBe(360);

    // Pagination PREPENDS x, y: every old row shifts down by two indices.
    const beforeTotal = list.totalHeight();
    keys.unshift("x", "y");
    count = 5;
    // The new rows mount and are measured with their real heights; the old
    // rows are NOT re-mounted, so their heights must survive the index shift.
    measure(list, "x", 110);
    measure(list, "y", 130);
    await Promise.resolve();

    expect(list.totalHeight()).toBe(110 + 130 + 100 + 120 + 140);
    // The re-anchor delta is the sum of the inserted rows only.
    expect(list.totalHeight() - beforeTotal).toBe(110 + 130);
  });
});
