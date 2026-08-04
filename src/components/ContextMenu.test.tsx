// L1/L2 tests for the reusable context menu (TASK-M8-03): the pure position
// helpers (viewport clamp, wrap-around keyboard index, submenu flip), and the
// component behaviors — item rendering (labels / hints / danger / disabled /
// separators), cursor positioning clamped to the viewport, full keyboard
// navigation (arrows with wrap, Home/End, Enter/Space, disabled skipping),
// submenu open/close via hover/click/arrows with Esc-priority, and the close
// paths (backdrop click, Escape, window scroll, window resize).

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import ContextMenu, {
  clampMenuPosition,
  nextSelectableIndex,
  quoteBlock,
  submenuX,
  type MenuItem,
} from "./ContextMenu";

function makeItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return { id: "item", label: "Item", onSelect: vi.fn(), ...overrides };
}

function renderMenu(overrides: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  const props = {
    testId: "cm",
    x: 40,
    y: 50,
    items: [] as MenuItem[],
    onClose: vi.fn(),
    ...overrides,
  };
  render(() => <ContextMenu {...props} />);
  return props;
}

afterEach(() => {
  // Restore the default jsdom viewport.
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});

describe("clampMenuPosition", () => {
  it("keeps a position that fits unchanged", () => {
    expect(clampMenuPosition(30, 40, 200, 300, 1000, 800)).toEqual({ x: 30, y: 40 });
  });

  it("clamps x and y into the viewport", () => {
    expect(clampMenuPosition(950, 750, 200, 300, 1000, 800)).toEqual({ x: 800, y: 500 });
  });

  it("never goes negative", () => {
    expect(clampMenuPosition(-50, -20, 200, 300, 1000, 800)).toEqual({ x: 0, y: 0 });
  });

  it("pins to the origin when the panel is larger than the viewport", () => {
    expect(clampMenuPosition(300, 400, 2000, 2000, 1000, 800)).toEqual({ x: 0, y: 0 });
  });
});

describe("nextSelectableIndex", () => {
  const items: MenuItem[] = [
    makeItem({ id: "a" }),
    { separator: true },
    makeItem({ id: "b", disabled: true }),
    makeItem({ id: "c" }),
  ];

  it("moves forward and backward through selectable items", () => {
    expect(nextSelectableIndex(items, -1, 1)).toBe(0);
    expect(nextSelectableIndex(items, 0, 1)).toBe(3);
    expect(nextSelectableIndex(items, 3, 1)).toBe(0);
    expect(nextSelectableIndex(items, 3, -1)).toBe(0);
  });

  it("skips separators and disabled items", () => {
    // Index 1 is a separator and index 2 is disabled — never returned.
    const seen = [0, 3, 0, 3];
    let from = -1;
    for (let i = 0; i < 4; i++) {
      from = nextSelectableIndex(items, from, 1);
      expect(from).toBe(seen[i]);
    }
  });

  it("returns -1 when nothing is selectable", () => {
    const allDisabled = [makeItem({ disabled: true }), { separator: true }];
    expect(nextSelectableIndex(allDisabled, -1, 1)).toBe(-1);
  });

  it("Home/End via -1 select the first and last selectable item", () => {
    expect(nextSelectableIndex(items, -1, 1)).toBe(0);
    expect(nextSelectableIndex(items, -1, -1)).toBe(3);
  });
});

describe("submenuX", () => {
  it("anchors to the parent's right edge when it fits", () => {
    expect(submenuX(100, 180, 176, 1000)).toBe(280);
  });

  it("flips to the left edge when the right side overflows", () => {
    expect(submenuX(900, 180, 176, 1000)).toBe(724);
  });

  it("clamps a flipped submenu into the viewport", () => {
    expect(submenuX(20, 1000, 176, 1000)).toBe(0);
  });

  it("flips when the parent's right edge already overflows", () => {
    expect(submenuX(800, 260, 176, 1000)).toBe(624);
  });
});

describe("quoteBlock", () => {
  it("prefixes every line with a blockquote marker", () => {
    expect(quoteBlock("first\nsecond")).toBe("> first\n> second");
  });

  it("handles a single line and blank input", () => {
    expect(quoteBlock("solo")).toBe("> solo");
    expect(quoteBlock("")).toBe("");
  });
});

describe("ContextMenu items", () => {
  it("renders labels, hints and icons in order", () => {
    const hintIcon = <svg data-testid="hint-icon" />;
    renderMenu({
      items: [
        makeItem({ id: "a", label: "Alpha", hint: "⌘K" }),
        makeItem({ id: "b", label: "Beta", icon: hintIcon }),
      ],
    });

    expect(screen.getByTestId("cm-a")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("cm-a")).toHaveTextContent("⌘K");
    expect(screen.getByTestId("cm-b")).toHaveTextContent("Beta");
    expect(screen.getByTestId("cm-b").querySelector('[data-testid="hint-icon"]')).not.toBeNull();
  });

  it("marks danger items and renders separators", () => {
    renderMenu({
      items: [makeItem({ id: "del", label: "Delete", danger: true }), { separator: true }],
    });

    expect(screen.getByTestId("cm-del")).toHaveTextContent("Delete");
    expect(screen.getByTestId("cm-del").className).toContain("text-danger");
    expect(screen.getByRole("separator")).toHaveAttribute("data-separator", "true");
  });

  it("renders disabled items inert", () => {
    const onSelect = vi.fn();
    renderMenu({ items: [makeItem({ id: "off", disabled: true, onSelect })] });

    expect(screen.getByTestId("cm-off")).toBeDisabled();
    fireEvent.click(screen.getByTestId("cm-off"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selecting an item runs onSelect and closes", () => {
    const onSelect = vi.fn();
    const props = renderMenu({ items: [makeItem({ id: "go", onSelect })] });

    fireEvent.click(screen.getByTestId("cm-go"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("a keepOpen item runs onSelect without closing", () => {
    const onSelect = vi.fn();
    const props = renderMenu({ items: [makeItem({ id: "go", onSelect, keepOpen: true })] });

    fireEvent.click(screen.getByTestId("cm-go"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("clamps the menu position to the viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
    renderMenu({ x: 3000, y: 3000, items: [makeItem({})] });

    expect(screen.getByTestId("cm")).toHaveStyle({ left: "400px", top: "400px" });
  });
});

describe("ContextMenu keyboard", () => {
  it("navigates with arrows (wrapping, skipping disabled), Enter selects, Home/End jump", () => {
    const onSelectA = vi.fn();
    const onSelectC = vi.fn();
    renderMenu({
      items: [
        makeItem({ id: "a", label: "A", onSelect: onSelectA }),
        makeItem({ id: "b", label: "B", disabled: true }),
        makeItem({ id: "c", label: "C", onSelect: onSelectC }),
      ],
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByTestId("cm-a")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByTestId("cm-c")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByTestId("cm-a")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByTestId("cm-c")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectC).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByTestId("cm-a")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByTestId("cm-c")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: " " });
    expect(onSelectC).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and on the backdrop click", () => {
    const props = renderMenu({ items: [makeItem({})] });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("cm-backdrop"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on window scroll and resize", () => {
    const props = renderMenu({ items: [makeItem({})] });

    fireEvent.scroll(window);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent(window, new Event("resize"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("Enter without a highlight does nothing", () => {
    const onSelect = vi.fn();
    const props = renderMenu({ items: [makeItem({ onSelect })] });

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("ContextMenu submenus", () => {
  const subItem = () => makeItem({ id: "sub-1", label: "Sub item" });

  it("opens on hover and closes when a plain item is hovered", async () => {
    renderMenu({
      items: [
        makeItem({ id: "parent", label: "Parent", submenu: [subItem()] }),
        makeItem({ id: "other", label: "Other" }),
      ],
    });

    fireEvent.mouseEnter(screen.getByTestId("cm-parent"));
    expect(screen.getByTestId("cm-submenu")).toBeInTheDocument();
    expect(screen.getByTestId("cm-sub-1")).toHaveTextContent("Sub item");

    fireEvent.mouseEnter(screen.getByTestId("cm-other"));
    await waitFor(() => expect(screen.queryByTestId("cm-submenu")).not.toBeInTheDocument());
  });

  it("selecting a submenu item runs its onSelect and closes everything", () => {
    const onSelect = vi.fn();
    const props = renderMenu({
      items: [
        makeItem({ id: "parent", label: "Parent", submenu: [makeItem({ id: "sub-1", onSelect })] }),
      ],
    });

    fireEvent.mouseEnter(screen.getByTestId("cm-parent"));
    fireEvent.click(screen.getByTestId("cm-sub-1"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("opens with ArrowRight, navigates inside, Enter selects, ArrowLeft and Esc close it", () => {
    const onSelect = vi.fn();
    renderMenu({
      items: [
        makeItem({ id: "parent", label: "Parent", submenu: [makeItem({ id: "sub-1", onSelect })] }),
      ],
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("cm-submenu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByTestId("cm-sub-1")).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Esc closes the submenu first, then the menu itself.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("cm-submenu")).not.toBeInTheDocument();
  });

  it("clicking a submenu parent opens it instead of selecting", () => {
    const props = renderMenu({
      items: [makeItem({ id: "parent", label: "Parent", submenu: [subItem()] })],
    });

    fireEvent.click(screen.getByTestId("cm-parent"));
    expect(screen.getByTestId("cm-submenu")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("renders disabled placeholder rows inside submenus", () => {
    renderMenu({
      items: [
        makeItem({
          id: "parent",
          label: "Parent",
          submenu: [makeItem({ id: "coming", label: "Not available", disabled: true })],
        }),
      ],
    });

    fireEvent.mouseEnter(screen.getByTestId("cm-parent"));
    expect(screen.getByTestId("cm-coming")).toBeDisabled();
  });
});
