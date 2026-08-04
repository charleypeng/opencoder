// L1 tests for the page transition helper (TASK-M7-07): the pure
// depth-delta mapping that decides the enter animation class at the
// MobileShell navigation level (push = slide-in-right, pop = slide-in
// from the left, no change = none).

import { describe, expect, it } from "vitest";
import { pageEnterClass, pageEnterDir, routeKey } from "./transitions";

describe("pageEnterDir", () => {
  it("maps a depth increase to forward", () => {
    expect(pageEnterDir(1, 2)).toBe("forward");
  });

  it("maps a depth decrease to back", () => {
    expect(pageEnterDir(3, 2)).toBe("back");
  });

  it("maps an unchanged depth to none", () => {
    expect(pageEnterDir(2, 2)).toBe("none");
  });
});

describe("pageEnterClass", () => {
  it("maps directions to the CSS classes", () => {
    expect(pageEnterClass("forward")).toBe("page-enter-forward");
    expect(pageEnterClass("back")).toBe("page-enter-back");
    expect(pageEnterClass("none")).toBe("");
  });
});

describe("routeKey", () => {
  it("identifies a route by page + params", () => {
    expect(routeKey({ page: "sessions" })).toBe("sessions");
    expect(routeKey({ page: "chat", params: { sessionId: "s1" } })).toBe('chat:{"sessionId":"s1"}');
    expect(routeKey({ page: "chat", params: { sessionId: "s2" } })).toBe('chat:{"sessionId":"s2"}');
  });

  it("keys file-view pushes by their path param (TASK-M7-09)", () => {
    expect(routeKey({ page: "file-view", params: { path: "src/a.ts" } })).toBe(
      'file-view:{"path":"src/a.ts"}',
    );
    expect(routeKey({ page: "file-view", params: { path: "src/b.ts" } })).toBe(
      'file-view:{"path":"src/b.ts"}',
    );
  });

  it("keys diff pushes by the full params so a new message remounts", () => {
    const first = routeKey({ page: "diff", params: { sessionId: "s1", messageID: "m1" } });
    const second = routeKey({ page: "diff", params: { sessionId: "s1", messageID: "m2" } });
    expect(first).toBe('diff:{"sessionId":"s1","messageID":"m1"}');
    expect(first).not.toBe(second);
  });
});
