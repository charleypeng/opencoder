import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { Component } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import FileViewer from "../../features/files/FileViewer";
import DiffView from "../../features/vcs/DiffView";
import VcsPanel from "../../features/vcs/VcsPanel";
import { closeTab, setActive, viewer, type ViewerServerState } from "../../stores/viewer";
import { useT } from "../../i18n/index.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./workbench.css";

export type RightToolView = "review" | "files" | "browser";
export interface RightToolPanelProps {
  serverId: string;
  directory?: string;
  open: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
  onOpenChange: (open: boolean) => void;
  onMaximizedChange: (maximized: boolean) => void;
  maximized?: boolean;
  view?: RightToolView;
  onViewChange?: (view: RightToolView) => void;
  showHeaderControls?: boolean;
  onOpenFile?: (path: string) => void;
  reviewSessionId?: string;
  reviewMessageId?: string;
  onClearReviewDiff?: () => void;
  requestVersion?: number;
}
export const RIGHT_PANEL_DEFAULT_WIDTH = 464;
const RIGHT_PANEL_WIDTH_KEY = "oc-right-tools-width";
export function clampRightToolPanelWidth(width: number, availableWidth: number): number {
  return Math.min(
    Number.isFinite(width) ? Math.max(0, width) : 0,
    Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0,
  );
}
export function readRightToolPanelWidth(): number {
  try {
    const raw = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
    if (raw !== null && Number.isFinite(Number(raw))) return Math.max(0, Number(raw));
  } catch {
    /* Storage is optional in embedded webviews. */
  }
  return RIGHT_PANEL_DEFAULT_WIDTH;
}
export function persistRightToolPanelWidth(width: number): void {
  try {
    localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(Math.max(0, width)));
  } catch {
    /* Keep resizing available without storage. */
  }
}
interface WorkbenchTab {
  id: string;
  kind: RightToolView;
  path?: string;
  name?: string;
  sessionId?: string;
  messageId?: string;
}

const BrowserPage: Component<{ id: string; onNavigate: (hostname: string) => void }> = (props) => {
  const t = useT();
  const [address, setAddress] = createSignal("");
  const [target, setTarget] = createSignal("");
  return (
    <div data-testid="right-tools-browser-pane" class="flex h-full min-h-0 flex-col gap-3 p-3">
      <form
        class="flex shrink-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = address().trim();
          if (!value) return;
          const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
          try {
            if (!["http:", "https:"].includes(new URL(url).protocol)) return;
          } catch {
            return;
          }
          setAddress(url);
          setTarget(url);
          props.onNavigate(new URL(url).hostname);
        }}
      >
        <input
          id={`browser-url-${props.id}`}
          aria-label={t("desktop:browserUrl")}
          data-testid="right-tools-browser-url"
          value={address()}
          placeholder={t("desktop:browserUrlPlaceholder")}
          class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-elevated px-2 py-1.5 text-xs outline-none focus:border-accent"
          onInput={(event) => setAddress(event.currentTarget.value)}
        />
        <button
          type="submit"
          data-testid="right-tools-browser-go"
          class="rounded-md bg-bg-sunken px-2 text-xs"
        >
          {t("desktop:browserGo")}
        </button>
      </form>
      <Show
        when={target()}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-fg-secondary">
            <p>{t("desktop:browserEmpty")}</p>
            <p>{t("desktop:browserEmptyHint")}</p>
          </div>
        }
      >
        <button
          type="button"
          data-testid="right-tools-browser-external"
          class="self-end text-xs text-fg-secondary"
          onClick={() => {
            void openUrl(target()).catch(() => {});
          }}
        >
          {t("desktop:browserOpenExternal")}
        </button>
        <iframe
          data-testid="right-tools-browser-frame"
          src={target()}
          title={t("desktop:browserFrameTitle")}
          sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts"
          referrerpolicy="no-referrer"
          class="min-h-0 flex-1 rounded-md border border-bg-sunken bg-bg-base"
        />
        <p class="text-xs text-fg-faint">{t("desktop:browserFrameHint")}</p>
      </Show>
    </div>
  );
};

const RightToolPanel: Component<RightToolPanelProps> = (props) => {
  const t = useT();
  const [tabs, updateTabs] = createStore<WorkbenchTab[]>([{ id: "review", kind: "review" }]);
  const setTabs = (next: WorkbenchTab[]) => updateTabs(reconcile(next, { key: "id" }));
  const [activeId, setActiveId] = createSignal("review");
  const [visited, setVisited] = createSignal(new Set<string>());
  const [internalWidth, setInternalWidth] = createSignal(readRightToolPanelWidth());
  const [internalMaximized, setInternalMaximized] = createSignal(false);
  const [availableWidth, setAvailableWidth] = createSignal(Math.max(0, window.innerWidth - 360));
  const [adding, setAdding] = createSignal(false);
  let panelRef: HTMLElement | undefined;
  let sequence = 0;
  let context = "";
  let staleViewer: ViewerServerState | undefined;
  let addMenuRef: HTMLDivElement | undefined;
  let addButtonRef: HTMLButtonElement | undefined;
  let startX: number | null = null;
  let startWidth = 0;
  let pendingWidth = 0;
  let resizeFrame: number | undefined;
  const maximized = () => props.maximized ?? internalMaximized();
  const width = () => clampRightToolPanelWidth(props.width ?? internalWidth(), availableWidth());
  const active = createMemo(() => tabs.find((tab) => tab.id === activeId()));
  const label = (tab: WorkbenchTab) =>
    tab.name ??
    (tab.sessionId
      ? `${t("desktop:sessionDiff")}${tab.messageId ? ` · ${tab.messageId.slice(-6)}` : ""}`
      : t(
          tab.kind === "review"
            ? "desktop:review"
            : tab.kind === "files"
              ? "desktop:filesTab"
              : "desktop:browser",
        ));
  function measure(): void {
    const parent = panelRef?.parentElement;
    const parentWidth = parent?.getBoundingClientRect().width || window.innerWidth;
    const siblings = parent
      ? Array.from(parent.children)
          .filter((element) => element !== panelRef && element.tagName !== "MAIN")
          .reduce((sum, element) => sum + element.getBoundingClientRect().width, 0)
      : 0;
    setAvailableWidth(Math.max(0, Math.floor(parentWidth - siblings - 360)));
  }
  function select(tab: WorkbenchTab): void {
    setActiveId(tab.id);
    if (tab.path) setActive(props.serverId, tab.path);
    props.onViewChange?.(tab.kind);
  }
  function add(kind: RightToolView): void {
    setAdding(false);
    const existing = kind !== "browser" ? tabs.find((tab) => tab.id === kind) : undefined;
    if (existing) {
      select(existing);
      return;
    }
    const tab: WorkbenchTab = { id: kind === "browser" ? `browser-${++sequence}` : kind, kind };
    setTabs([...tabs, tab]);
    select(tab);
    if (kind === "review") props.onClearReviewDiff?.();
  }
  function close(tab: WorkbenchTab): void {
    const wasActive = activeId() === tab.id;
    const index = tabs.findIndex((item) => item.id === tab.id);
    const remaining = tabs.filter((item) => item.id !== tab.id);
    setTabs(remaining);
    setVisited((previous) => {
      const next = new Set(previous);
      next.delete(tab.id);
      return next;
    });
    if (tab.path) closeTab(props.serverId, tab.path);
    if (wasActive) {
      const next = remaining[Math.max(0, index - 1)];
      if (next) {
        select(next);
        queueMicrotask(() => document.getElementById(`workbench-tab-${next.id}`)?.focus());
      } else setActiveId("");
      if (!next) queueMicrotask(() => addButtonRef?.focus());
    }
  }
  createEffect(() => {
    const nextContext = JSON.stringify([props.serverId, props.directory]);
    if (context !== nextContext) {
      staleViewer =
        context && viewer[props.serverId]?.tabs.length ? viewer[props.serverId] : undefined;
      context = nextContext;
      setTabs([{ id: "review", kind: "review" }]);
      setActiveId("review");
      setVisited(new Set<string>());
      setAdding(false);
    }
  });
  createEffect(() => {
    const bucket = viewer[props.serverId];
    const files = bucket !== staleViewer ? (bucket?.tabs ?? []) : [];
    const paths = new Set(files.map((tab) => tab.path));
    const retained = tabs.filter((tab) => !tab.path || paths.has(tab.path));
    const known = new Set(retained.map((tab) => tab.path));
    const additions = files
      .filter((file) => !known.has(file.path))
      .map((file) => ({
        id: `file:${file.path}`,
        kind: "files" as const,
        path: file.path,
        name: file.name,
      }));
    if (retained.length !== tabs.length || additions.length) {
      setTabs([...retained, ...additions]);
      const remainingIds = new Set([...retained, ...additions].map((tab) => tab.id));
      setVisited((previous) => new Set([...previous].filter((id) => remainingIds.has(id))));
    }
    if (!tabs.some((tab) => tab.id === activeId())) setActiveId(tabs[0]?.id ?? "");
  });
  createEffect(
    on(
      () => ({
        view: props.view,
        path: viewer[props.serverId]?.activePath,
        request: props.requestVersion,
      }),
      ({ view, path }) => {
        if (view === "files" && path) setActiveId(`file:${path}`);
        else if (view === "review" && !props.reviewSessionId) {
          const review = tabs.find((tab) => tab.id === "review");
          if (review) setActiveId(review.id);
          else add("review");
        } else if (view && active()?.kind !== view) {
          const tab = tabs.find((item) => item.kind === view);
          if (tab) setActiveId(tab.id);
          else add(view);
        }
      },
    ),
  );
  createEffect(
    on(
      () => ({
        sessionId: props.reviewSessionId,
        messageId: props.reviewMessageId,
        request: props.requestVersion,
      }),
      ({ sessionId, messageId }) => {
        if (!sessionId || props.view !== "review") return;
        const id = `review:${sessionId}:${messageId ?? "all"}`;
        if (!tabs.some((tab) => tab.id === id))
          setTabs([...tabs, { id, kind: "review", sessionId, messageId }]);
        setActiveId(id);
      },
    ),
  );
  createEffect(() => {
    const id = activeId();
    if (props.open && id && !visited().has(id)) setVisited(new Set([...visited(), id]));
    queueMicrotask(() =>
      document
        .getElementById(`workbench-tab-${id}`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" }),
    );
  });
  createEffect(() => {
    if (!adding()) return;
    queueMicrotask(() => addMenuRef?.querySelector("button")?.focus());
    const dismiss = (event: PointerEvent) => {
      if (
        !addMenuRef?.contains(event.target as Node) &&
        !addButtonRef?.contains(event.target as Node)
      )
        setAdding(false);
    };
    document.addEventListener("pointerdown", dismiss);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss));
  });
  function updateWidth(next: number): number {
    const value = clampRightToolPanelWidth(next, availableWidth());
    if (props.width === undefined) setInternalWidth(value);
    props.onWidthChange?.(value);
    return value;
  }
  function commit(next: number): void {
    const value = updateWidth(next);
    if (props.width === undefined) persistRightToolPanelWidth(value);
    props.onWidthCommit?.(value);
  }
  function move(event: PointerEvent): void {
    if (startX === null) return;
    pendingWidth = startWidth - (event.clientX - startX);
    if (resizeFrame === undefined)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        updateWidth(pendingWidth);
      });
  }
  function stop(): void {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    resizeFrame = undefined;
    if (startX !== null) commit(pendingWidth);
    startX = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  }
  onMount(() => {
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    if (panelRef?.parentElement) {
      observer?.observe(panelRef.parentElement);
      for (const child of panelRef.parentElement.children) {
        if (child !== panelRef && child.tagName !== "MAIN") observer?.observe(child);
      }
    }
    window.addEventListener("resize", measure);
    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    });
  });
  onCleanup(stop);
  return (
    <section
      ref={panelRef}
      data-testid="right-tool-panel"
      data-collapsed={!maximized() && width() === 0 ? "true" : "false"}
      data-maximized={maximized() ? "true" : "false"}
      aria-hidden={!props.open || (!maximized() && width() === 0) ? "true" : undefined}
      style={{
        display: props.open ? undefined : "none",
        width: maximized() ? "100%" : `${width()}px`,
      }}
      class={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg-base transition-none ${maximized() ? "flex-1" : "shrink-0 border-l border-bg-sunken"}`}
    >
      <Show when={!maximized()}>
        <div
          data-testid="right-tools-resize-handle"
          role="separator"
          aria-label={t("desktop:resizeTools")}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={availableWidth()}
          aria-valuenow={width()}
          tabIndex={0}
          class="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-accent-soft focus-visible:bg-accent-soft"
          onPointerDown={(event) => {
            if (event.button !== 0 || !props.open) return;
            event.preventDefault();
            measure();
            startX = event.clientX;
            startWidth = width();
            pendingWidth = startWidth;
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
          }}
          onDblClick={() => commit(RIGHT_PANEL_DEFAULT_WIDTH)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 64 : 16;
            const next =
              event.key === "ArrowLeft"
                ? width() + step
                : event.key === "ArrowRight"
                  ? width() - step
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? availableWidth()
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              commit(next);
            }
          }}
        />
      </Show>
      <header class="workbench-tab-header relative flex h-10 shrink-0 items-center gap-1 border-b border-bg-sunken bg-bg-elevated px-2">
        {/* Own only the tab buttons so adjacent close controls remain independently accessible. */}
        <Show when={tabs.length > 0}>
          <div
            role="tablist"
            aria-label={t("desktop:toolsView")}
            aria-owns={tabs.map((tab) => `workbench-tab-${tab.id}`).join(" ")}
            class="sr-only"
          />
        </Show>
        <div class="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          <For each={tabs}>
            {(tab) => (
              <div
                class="workbench-tab flex min-w-0 shrink-0 items-center"
                data-active={activeId() === tab.id}
              >
                <button
                  type="button"
                  role="tab"
                  data-workbench-kind={tab.kind}
                  id={`workbench-tab-${tab.id}`}
                  aria-controls={`workbench-pane-${tab.id}`}
                  tabIndex={activeId() === tab.id ? 0 : -1}
                  aria-selected={activeId() === tab.id}
                  data-testid={
                    tab.id === "review"
                      ? "right-tools-review"
                      : tab.id === "files"
                        ? "right-tools-files"
                        : tab.kind === "browser"
                          ? "right-tools-browser"
                          : "right-tools-file-tab"
                  }
                  title={tab.path ?? label(tab)}
                  class="min-w-0 max-w-36 truncate px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  onClick={() => select(tab)}
                  onKeyDown={(event) => {
                    if (event.key === "Delete") {
                      event.preventDefault();
                      close(tab);
                      return;
                    }
                    const index = tabs.findIndex((item) => item.id === tab.id);
                    const next =
                      event.key === "ArrowRight"
                        ? tabs[(index + 1) % tabs.length]
                        : event.key === "ArrowLeft"
                          ? tabs[(index + tabs.length - 1) % tabs.length]
                          : event.key === "Home"
                            ? tabs[0]
                            : event.key === "End"
                              ? tabs[tabs.length - 1]
                              : undefined;
                    if (next) {
                      event.preventDefault();
                      select(next);
                      document.getElementById(`workbench-tab-${next.id}`)?.focus();
                    }
                  }}
                >
                  {label(tab)}
                </button>
                <button
                  type="button"
                  aria-label={`${t("desktop:closeWorkspaceTab")}: ${label(tab)}`}
                  class="mr-1 flex h-5 w-5 items-center justify-center rounded text-xs text-fg-faint hover:bg-bg-sunken hover:text-fg-primary"
                  onClick={() => close(tab)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
        <button
          ref={addButtonRef}
          type="button"
          data-testid="right-tools-add-tab"
          aria-label={t("desktop:addWorkspaceTab")}
          aria-expanded={adding()}
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-sunken"
          onClick={() => setAdding(!adding())}
        >
          +
        </button>
        <Show when={props.showHeaderControls !== false}>
          <button
            type="button"
            data-testid="right-tools-maximize"
            aria-label={maximized() ? t("desktop:restoreTools") : t("desktop:maximizeTools")}
            aria-pressed={maximized()}
            class="px-1 text-xs"
            onClick={() => {
              const next = !maximized();
              if (props.maximized === undefined) setInternalMaximized(next);
              props.onMaximizedChange(next);
            }}
          >
            ↗
          </button>
          <button
            type="button"
            data-testid="right-tools-collapse"
            aria-label={t("desktop:closeTools")}
            class="px-1 text-xs"
            onClick={() => {
              if (props.maximized === undefined) setInternalMaximized(false);
              props.onMaximizedChange(false);
              props.onOpenChange(false);
            }}
          >
            ×
          </button>
        </Show>
      </header>
      <Show when={adding()}>
        <div
          ref={addMenuRef}
          class="absolute right-2 top-10 z-20 flex flex-col rounded-md border border-bg-sunken bg-bg-elevated p-1 shadow-lg"
          role="group"
          aria-label={t("desktop:addWorkspaceTab")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setAdding(false);
              addButtonRef?.focus();
            }
          }}
        >
          <For each={["review", "files", "browser"] as RightToolView[]}>
            {(kind) => (
              <button
                type="button"
                data-testid={`right-tools-add-${kind}`}
                class="rounded-md px-2 py-1 text-xs hover:bg-bg-sunken"
                onClick={() => add(kind)}
              >
                {t(
                  kind === "review"
                    ? "desktop:review"
                    : kind === "files"
                      ? "desktop:filesTab"
                      : "desktop:browser",
                )}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <Show when={tabs.length === 0}>
          <div class="flex h-full items-center justify-center p-4 text-xs text-fg-secondary">
            {t("desktop:workspaceEmpty")}
          </div>
        </Show>
        <For each={tabs}>
          {(tab) => (
            <div
              id={`workbench-pane-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`workbench-tab-${tab.id}`}
              hidden={activeId() !== tab.id}
              class="workbench-tab-content h-full min-h-0"
              data-active={activeId() === tab.id}
            >
              <Show when={visited().has(tab.id)}>
                <Show when={tab.kind === "review"}>
                  <Show when={tab.sessionId} fallback={<VcsPanel serverId={props.serverId} />}>
                    <div data-testid="right-tools-review-diff" class="h-full min-h-0">
                      <DiffView
                        serverId={props.serverId}
                        sessionId={tab.sessionId!}
                        messageId={tab.messageId!}
                      />
                    </div>
                  </Show>
                </Show>
                <Show when={tab.kind === "files"}>
                  <div data-testid="right-tools-files-pane" class="h-full min-h-0">
                    <Show
                      when={tab.path}
                      fallback={
                        <FileViewer
                          serverId={props.serverId}
                          hideTabs
                          activePath=""
                          visible={props.open && activeId() === tab.id}
                        />
                      }
                    >
                      <FileViewer
                        serverId={props.serverId}
                        hideTabs
                        activePath={tab.path}
                        visible={props.open && activeId() === tab.id}
                      />
                    </Show>
                  </div>
                </Show>
                <Show when={tab.kind === "browser"}>
                  <BrowserPage
                    id={tab.id}
                    onNavigate={(hostname) =>
                      setTabs(
                        tabs.map((item) =>
                          item.id === tab.id ? { ...item, name: hostname } : item,
                        ),
                      )
                    }
                  />
                </Show>
              </Show>
            </div>
          )}
        </For>
      </div>
    </section>
  );
};
export default RightToolPanel;
