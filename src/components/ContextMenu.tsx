// Reusable context menu (TASK-M8-03): a single positioned menu shared by the
// session rows, the message actions, the file tree and the selected-text
// menu (DesktopShell). Rendered as a fixed overlay at (x, y) clamped to the
// viewport, with a full-screen backdrop (click to close, native menu
// suppressed), window scroll/resize close, and keyboard navigation:
//
//   - The browser's contextmenu event is the ONLY trigger contract: any
//     focused element with an onContextMenu handler (session rows, file
//     rows, message columns) opens the menu on the Menu key for free — the
//     browser fires contextmenu at the focused element's position.
//   - While open: ↑/↓ move the highlight (skipping disabled rows and
//     separators, wrapping), Home/End jump to the first/last selectable
//     row, Enter/Space select, Esc closes (the open submenu first), and
//     →/← open/close a submenu.
//   - Submenus open on hover or → at the parent's right edge, flipping to
//     the left edge when the right side would overflow the viewport; ← or
//     Esc close them.
//
// MenuItem shape: label + optional icon/hint (right-aligned shortcut)/
// danger styling/submenu; `separator` renders a divider row; `disabled`
// rows are inert and skipped by navigation; `keepOpen` runs onSelect
// without closing (used by the file tree's "✓ Copied" clipboard feedback).
// Selecting any other item closes the menu first, then runs onSelect.

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component, JSX } from "solid-js";

export interface MenuItem {
  /** Stable id used for the data-testid (`${testId}-${id}`). */
  id?: string;
  label?: string;
  /** Leading icon (any element). */
  icon?: JSX.Element;
  /** Right-aligned shortcut hint (e.g. "⌘K"). */
  hint?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Renders a divider row instead of an item. */
  separator?: boolean;
  /** Danger styling (destructive actions). */
  danger?: boolean;
  /** Nested menu: opens beside the row (hover/click/→). */
  submenu?: MenuItem[];
  /** Runs onSelect without closing the menu (e.g. copy feedback). */
  keepOpen?: boolean;
}

export interface ContextMenuProps {
  /** Cursor / anchor position. */
  x: number;
  y: number;
  items: MenuItem[];
  /** Called on close (backdrop click, Esc, scroll, resize, item select). */
  onClose: () => void;
  /** Base for the data-testid attributes (root, backdrop, items). */
  testId?: string;
  /** Accessible name of the menu. */
  label?: string;
}

/** Clamps a (width×height) panel position so it stays inside the viewport;
 *  panels larger than the viewport pin to the origin. */
export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, viewportWidth - Math.min(width, viewportWidth)))),
    y: Math.max(0, Math.min(y, Math.max(0, viewportHeight - Math.min(height, viewportHeight)))),
  };
}

/** Index of the next selectable item (separators and disabled rows are
 *  skipped), wrapping around. `from` = -1 selects the first (delta > 0) or
 *  last (delta < 0) selectable row. -1 when nothing is selectable. */
export function nextSelectableIndex(items: MenuItem[], from: number, delta: number): number {
  const selectable: number[] = [];
  for (let index = 0; index < items.length; index++) {
    if (!items[index].separator && !items[index].disabled) selectable.push(index);
  }
  if (selectable.length === 0) return -1;
  if (from < 0) return delta > 0 ? selectable[0] : selectable[selectable.length - 1];
  const position = selectable.indexOf(from);
  const base = position < 0 ? (delta > 0 ? -1 : 0) : position;
  return selectable[(base + delta + selectable.length) % selectable.length];
}

/** Horizontal anchor of a submenu: the parent's right edge, flipped to the
 *  left edge when the right side overflows the viewport, always clamped
 *  into the viewport. */
export function submenuX(
  parentLeft: number,
  parentWidth: number,
  submenuWidth: number,
  viewportWidth: number,
): number {
  const right = parentLeft + parentWidth;
  const flip = right + submenuWidth > viewportWidth;
  const x = flip ? parentLeft - submenuWidth : right;
  return Math.max(0, Math.min(x, Math.max(0, viewportWidth - submenuWidth)));
}

/** Renders a text selection as a Markdown blockquote (each line prefixed
 *  with "> "), for the selected-text menu's "Quote in chat" item. */
export function quoteBlock(text: string): string {
  if (text === "") return "";
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** The min-width token of the panels (min-w-44 = 176px), used as the
 *  pre-measure size for the submenu flip decision. */
const PANEL_MIN_WIDTH = 176;

/** One menu row: a divider (separator) or a button with the optional
 *  icon / hint / submenu chevron, danger and disabled states. */
function MenuRow(props: {
  item: MenuItem;
  testId?: string;
  highlighted: boolean;
  expanded: boolean;
  onMouseEnter: () => void;
  onActivate: () => void;
  registerRef: (el: HTMLButtonElement | undefined) => void;
}) {
  const baseClass =
    "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm outline-none " +
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 disabled:cursor-not-allowed " +
    "disabled:opacity-50 hover:bg-accent-soft";
  return (
    <Show
      when={!props.item.separator}
      fallback={<div role="separator" data-separator="true" class="mx-1 my-1 h-px bg-bg-sunken" />}
    >
      <button
        type="button"
        ref={props.registerRef}
        data-testid={props.testId}
        data-highlighted={props.highlighted ? "true" : undefined}
        aria-haspopup={props.item.submenu !== undefined ? "menu" : undefined}
        aria-expanded={props.expanded ? "true" : undefined}
        disabled={props.item.disabled}
        class={
          props.item.danger
            ? `${baseClass} text-danger hover:bg-danger/10 ${
                props.highlighted ? "bg-danger/10" : ""
              }`
            : `${baseClass} ${props.highlighted ? "bg-accent-soft" : ""}`
        }
        onMouseEnter={() => props.onMouseEnter()}
        onClick={() => props.onActivate()}
      >
        {props.item.icon}
        <span class="min-w-0 flex-1 truncate text-left">{props.item.label}</span>
        <Show when={props.item.hint !== undefined}>
          <span class="shrink-0 pl-4 font-code text-xs text-fg-faint">{props.item.hint}</span>
        </Show>
        <Show when={props.item.submenu !== undefined}>
          <span class="shrink-0 pl-4 text-xs text-fg-faint" aria-hidden="true">
            ›
          </span>
        </Show>
      </button>
    </Show>
  );
}

const ContextMenu: Component<ContextMenuProps> = (props) => {
  const testId = () => props.testId ?? "context-menu";
  const [highlight, setHighlight] = createSignal(-1);
  const [subHighlight, setSubHighlight] = createSignal(-1);
  const [submenu, setSubmenu] = createSignal<{ index: number; x: number; y: number } | null>(null);
  const [measured, setMeasured] = createSignal<{ width: number; height: number } | null>(null);
  const [subPos, setSubPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  let rootRef: HTMLDivElement | undefined;
  let submenuRef: HTMLDivElement | undefined;
  const itemRefs = new Map<number, HTMLButtonElement>();

  /** The panel's clamped position: raw (x, y) until the mount measurement
   *  reports the real size, then corrected against the viewport. */
  const position = createMemo(() => {
    const size = measured();
    return clampMenuPosition(
      props.x,
      props.y,
      size?.width ?? 0,
      size?.height ?? 0,
      window.innerWidth,
      window.innerHeight,
    );
  });

  const activeItems = createMemo<MenuItem[]>(() => {
    const open = submenu();
    if (open === null) return props.items;
    return props.items[open.index]?.submenu ?? [];
  });

  function openSubmenuAt(index: number, element: HTMLButtonElement | undefined): void {
    const sub = props.items[index]?.submenu;
    if (sub === undefined || sub.length === 0) return;
    const rect = element?.getBoundingClientRect();
    setSubmenu({
      index,
      x: submenuX(rect?.left ?? 0, rect?.width ?? 0, PANEL_MIN_WIDTH, window.innerWidth),
      y: Math.max(0, rect?.top ?? 0),
    });
    setSubHighlight(-1);
  }

  function selectItem(item: MenuItem | undefined): void {
    if (item === undefined || item.disabled || item.separator) return;
    if (item.submenu !== undefined) return;
    if (!item.keepOpen) props.onClose();
    item.onSelect?.();
  }

  function onRowMouseEnter(item: MenuItem, index: number): void {
    if (item.disabled || item.separator) return;
    setHighlight(index);
    setSubHighlight(-1);
    if (item.submenu !== undefined) openSubmenuAt(index, itemRefs.get(index));
    else setSubmenu(null);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const items = activeItems();
    const current = submenu() === null ? highlight() : subHighlight();
    const setCurrent = (index: number) =>
      submenu() === null ? setHighlight(index) : setSubHighlight(index);
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        setCurrent(nextSelectableIndex(items, current, 1));
        break;
      case "ArrowUp":
        setCurrent(nextSelectableIndex(items, current, -1));
        break;
      case "Home":
        setCurrent(nextSelectableIndex(items, -1, 1));
        break;
      case "End":
        setCurrent(nextSelectableIndex(items, -1, -1));
        break;
      case "Enter":
      case " ":
        if (items[current]?.submenu !== undefined) {
          openSubmenuAt(current, itemRefs.get(current));
        } else {
          selectItem(items[current]);
        }
        break;
      case "ArrowRight":
        if (submenu() === null && items[current]?.submenu !== undefined) {
          openSubmenuAt(current, itemRefs.get(current));
        }
        break;
      case "ArrowLeft":
        if (submenu() !== null) {
          setSubmenu(null);
          setSubHighlight(-1);
        }
        break;
      case "Escape":
        if (submenu() !== null) {
          setSubmenu(null);
          setSubHighlight(-1);
        } else {
          props.onClose();
        }
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  // The open-menu listeners (keyboard + the resize/scroll close). The
  // createEffect registers them once on mount and tears them down on
  // unmount; the backdrop covers the rest of the UI meanwhile.
  createEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", props.onClose);
    window.addEventListener("scroll", props.onClose, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", props.onClose);
      window.removeEventListener("scroll", props.onClose, true);
    });
  });

  // Measure the rendered panel once and re-clamp the position with the real
  // size (jsdom reports 0×0, so tests observe the viewport clamp).
  createEffect(() => {
    const rect = rootRef?.getBoundingClientRect();
    setMeasured(rect === undefined ? null : { width: rect.width, height: rect.height });
  });

  // Same measurement pass for the open submenu panel.
  createEffect(() => {
    const open = submenu();
    if (open === null) return;
    const rect = submenuRef?.getBoundingClientRect();
    const width = rect?.width ?? 0;
    const height = rect?.height ?? 0;
    setSubPos(
      clampMenuPosition(open.x, open.y, width, height, window.innerWidth, window.innerHeight),
    );
  });

  onMount(() => {
    rootRef?.focus({ preventScroll: true });
  });

  const sub = () => submenu()!;
  const expandedAt = (index: number) => submenu()?.index === index;

  return (
    <>
      <div
        data-testid={`${testId()}-backdrop`}
        data-context-backdrop
        class="fixed inset-0 z-40"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={() => props.onClose()}
      />
      <div
        ref={rootRef}
        data-testid={testId()}
        data-context-menu
        role="menu"
        aria-label={props.label ?? "Context menu"}
        tabIndex={-1}
        class="glass fixed z-50 min-w-44 p-1 outline-none"
        style={{ left: `${position().x}px`, top: `${position().y}px` }}
      >
        <For each={props.items}>
          {(item, index) => (
            <MenuRow
              item={item}
              testId={item.id !== undefined ? `${testId()}-${item.id}` : undefined}
              highlighted={submenu() === null && highlight() === index()}
              expanded={expandedAt(index())}
              onMouseEnter={() => onRowMouseEnter(item, index())}
              onActivate={() => {
                if (item.submenu !== undefined) {
                  openSubmenuAt(index(), itemRefs.get(index()));
                  return;
                }
                selectItem(item);
              }}
              registerRef={(el) => {
                if (el !== undefined) itemRefs.set(index(), el);
                else itemRefs.delete(index());
              }}
            />
          )}
        </For>
      </div>
      <Show when={submenu() !== null}>
        <div
          ref={submenuRef}
          data-testid={`${testId()}-submenu`}
          role="menu"
          class="glass fixed z-50 min-w-44 p-1"
          style={{ left: `${subPos().x}px`, top: `${subPos().y}px` }}
        >
          <For each={props.items[sub().index]?.submenu ?? []}>
            {(item, index) => (
              <MenuRow
                item={item}
                testId={item.id !== undefined ? `${testId()}-${item.id}` : undefined}
                highlighted={subHighlight() === index()}
                expanded={false}
                onMouseEnter={() => setSubHighlight(index())}
                onActivate={() => selectItem(item)}
                registerRef={() => undefined}
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
};

export default ContextMenu;
