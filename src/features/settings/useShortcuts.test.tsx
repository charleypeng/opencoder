// L1 tests for the shortcut dispatch hook (TASK-M8-01): a harness mounts
// useShortcuts with mock actions and drives window keydown events. Covers
// combo dispatch (⌘ or Ctrl primary), scope gating (global/chat/list via
// the active-scope signal), the input guard (plain keys and guarded
// modifier shortcuts vs. the ⌘Enter/server-digit opt-outs), the digit
// range, defaultPrevented passthrough, custom combos from the overrides
// store, and listener cleanup on unmount.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEffect, createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import type { Component } from "solid-js";
import { useShortcuts, type ShortcutAction } from "./useShortcuts";
import { combo } from "./shortcuts";
import { resetAllShortcuts, saveShortcutCombo } from "./shortcutStore";

interface HarnessProps {
  actions: Record<string, ShortcutAction>;
  scope?: () => "global" | "chat" | "list";
}

const Harness: Component<HarnessProps> = (props) => {
  createEffect(() => {
    useShortcuts({
      actions: props.actions,
      activeScope: props.scope ?? (() => "global" as const),
    });
  });
  return <div data-testid="harness" />;
};

/** Fires a keydown on window and returns the event (for defaultPrevented). */
function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  resetAllShortcuts();
});

afterEach(() => {
  resetAllShortcuts();
});

describe("useShortcuts", () => {
  it("dispatches a global shortcut with either ⌘ or Ctrl", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ quickOpen: action }} />);

    press({ key: "p", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    press({ key: "p", ctrlKey: true });
    expect(action).toHaveBeenCalledTimes(2);
    // No primary modifier: no dispatch.
    press({ key: "p" });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("requires the other modifiers exactly and is case-insensitive", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ fullTextSearch: action }} />);

    press({ key: "F", metaKey: true, shiftKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    press({ key: "f", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("calls preventDefault before the action", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ quickOpen: action }} />);

    const event = press({ key: "p", metaKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches any digit of the switch-server range", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ switchServer: action }} />);

    press({ key: "3", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    press({ key: "0", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("keeps a guarded shortcut silent while a text control is focused", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ quickOpen: action }} />);
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "p", metaKey: true });
    expect(action).not.toHaveBeenCalled();
    press({ key: "p", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("fires the inputGuard opt-outs (send message) from inside a text control", () => {
    const action = vi.fn();
    const scope = () => "chat" as const;
    render(() => <Harness actions={{ sendMessage: action }} scope={scope} />);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    textarea.remove();
  });

  it("gates chat-scoped shortcuts on the active scope", () => {
    const action = vi.fn();
    const globalAction = vi.fn();
    const [scope, setScope] = createSignal<"global" | "chat" | "list">("global");
    render(() => (
      <Harness
        actions={{ sendMessage: action, quickOpen: globalAction }}
        scope={scope as () => "global" | "chat" | "list"}
      />
    ));

    // Global scope: the chat-scoped shortcut stays silent, global fires.
    press({ key: "Enter", metaKey: true });
    expect(action).not.toHaveBeenCalled();
    press({ key: "p", metaKey: true });
    expect(globalAction).toHaveBeenCalledTimes(1);

    // Chat scope: both fire.
    setScope("chat");
    press({ key: "Enter", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not leak scoped shortcuts across unrelated scopes", () => {
    const action = vi.fn();
    const [scope, setScope] = createSignal<"global" | "chat" | "list">("global");
    render(() => (
      <Harness actions={{ tabCycle: action }} scope={scope as () => "global" | "chat" | "list"} />
    ));

    press({ key: "Tab" });
    expect(action).not.toHaveBeenCalled();
    // A list-focused area does not enable the chat-scoped shortcut.
    setScope("list");
    press({ key: "Tab" });
    expect(action).not.toHaveBeenCalled();
    setScope("chat");
    press({ key: "Tab" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("ignores events a focused widget already handled", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ quickOpen: action }} />);
    const handled = new KeyboardEvent("keydown", {
      key: "p",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(action).not.toHaveBeenCalled();
  });

  it("dispatches custom combos from the overrides store", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ quickOpen: action }} />);
    saveShortcutCombo("quickOpen", combo("e"));

    press({ key: "p", metaKey: true });
    expect(action).not.toHaveBeenCalled();
    press({ key: "e", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", () => {
    const action = vi.fn();
    const { unmount } = render(() => <Harness actions={{ quickOpen: action }} />);

    press({ key: "p", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);

    unmount();
    press({ key: "p", metaKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("harness")).not.toBeInTheDocument();
  });

  it("ignores unknown action ids", () => {
    const action = vi.fn();
    render(() => <Harness actions={{ doesNotExist: action }} />);
    press({ key: "p", metaKey: true });
    expect(action).not.toHaveBeenCalled();
  });
});
