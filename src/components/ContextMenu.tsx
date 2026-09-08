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
import { Portal } from "solid-js/web";
import { useT } from "../i18n/index.js";

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

export type ContextMenuIconName =
  | "batch"
  | "change-directory"
  | "compress"
  | "copy"
  | "delete"
  | "folder"
  | "fork"
  | "generate"
  | "move"
  | "quote"
  | "rename"
  | "share";

/** Small, token-coloured outline icons used by desktop context menus. */
export function ContextMenuIcon(props: { name: ContextMenuIconName }) {
  const paths = () => {
    switch (props.name) {
      case "batch":
        return (
          <>
            <path d="M9 6h11M9 12h11M9 18h11" />
            <path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
          </>
        );
      case "change-directory":
        return (
          <>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            <path d="M12 12h7m-2.5-2.5L19 12l-2.5 2.5" />
          </>
        );
      case "compress":
        return (
          <>
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
            <path d="m9 9 3 3 3-3M9 15l3-3 3 3" />
          </>
        );
      case "copy":
        return (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" />
          </>
        );
      case "delete":
        return (
          <>
            <path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" />
          </>
        );
      case "folder":
        return (
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        );
      case "fork":
        return (
          <>
            <circle cx="7" cy="5" r="2" />
            <circle cx="17" cy="19" r="2" />
            <circle cx="7" cy="19" r="2" />
            <path d="M7 7v5a7 7 0 0 0 7 7M7 12a7 7 0 0 1 7-7h1" />
          </>
        );
      case "generate":
        return (
          <>
            <path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M14 3v5h5M8 14h8M8 18h5" />
          </>
        );
      case "move":
        return (
          <>
            <path d="M4 8h12m-3-3 3 3-3 3M20 16H8m3 3-3-3 3-3" />
          </>
        );
      case "quote":
        return (
          <>
            <path d="M9 8H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2l2-4V8zM21 8h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2l2-4V8z" />
          </>
        );
      case "rename":
        return (
          <>
            <path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20z" />
            <path d="m13.8 7.2 3 3" />
          </>
        );
      case "share":
        return (
          <>
            <path d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </>
        );
    }
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
    >
      {paths()}
    </svg>
  );
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
    "flex min-h-9 w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left text-sm " +
    "font-medium leading-5 outline-none transition-[background-color,color] duration-[var(--dur-fast)] " +
    "ease-[var(--ease-emphasized)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 " +
    "disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-soft focus-visible:bg-accent-soft " +
    "focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <Show
      when={!props.item.separator}
      fallback={
        <div
          role="separator"
          data-separator="true"
          class="mx-2 my-1.5 h-px bg-[color-mix(in_srgb,var(--fg-faint)_22%,transparent)]"
        />
      }
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
        <Show when={props.item.icon !== undefined}>
          <span
            data-testid={props.testId === undefined ? undefined : `${props.testId}-icon`}
            class="flex h-5 w-5 shrink-0 items-center justify-center"
          >
            {props.item.icon}
          </span>
        </Show>
        <span class="min-w-0 flex-1 truncate text-left">{props.item.label}</span>
        <Show when={props.item.hint !== undefined}>
          <span class="shrink-0 pl-4 font-code text-xs text-fg-faint">{props.item.hint}</span>
        </Show>
        <Show when={props.item.submenu !== undefined}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ml-2 h-4 w-4 shrink-0 text-fg-faint"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Show>
      </button>
    </Show>
  );
}

const ContextMenu: Component<ContextMenuProps> = (props) => {
  const t = useT();
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
    <Portal>
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
          aria-label={props.label ?? t("common:contextMenu")}
          tabIndex={-1}
          class="context-menu-panel fixed z-50 min-w-60 outline-none"
          style={{ left: `${position().x}px`, top: `${position().y}px` }}
        >
          {/* Inner clip: the panel has a large radius (--r-lg), while
              row highlights use a small one; clipping the rows to the panel
              radius keeps the hover highlight from poking out of the rounded
              corners. The shadow lives on the outer glass panel. */}
          <div class="overflow-hidden rounded-[calc(var(--r-lg)-4px)]">
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
        </div>
        <Show when={submenu() !== null}>
          <div
            ref={submenuRef}
            data-testid={`${testId()}-submenu`}
            role="menu"
            class="context-menu-panel fixed z-50 min-w-60"
            style={{ left: `${subPos().x}px`, top: `${subPos().y}px` }}
          >
            <div class="overflow-hidden rounded-[calc(var(--r-lg)-4px)]">
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
          </div>
        </Show>
      </>
    </Portal>
  );
};

export default ContextMenu;
