// Right-side workspace tools (TASK-UI-12): a Codex-inspired utility panel
// that keeps review, file browsing, and the browser entry point beside the
// chat without taking over the primary conversation flow. The panel owns its
// selected tool and splitter width; the shell owns visibility/maximize so
// the main pane can yield the full workspace when requested.

import { createSignal, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import FileViewer from "../../features/files/FileViewer";
import VcsPanel from "../../features/vcs/VcsPanel";
import { useT } from "../../i18n/index.js";
import { openUrl } from "@tauri-apps/plugin-opener";

export type RightToolView = "review" | "files" | "browser";

export interface RightToolPanelProps {
  /** The server whose workspace tools are shown. */
  serverId: string;
  /** Current workspace directory for the file browser. */
  directory?: string;
  /** Whether the tool panel content is expanded. */
  open: boolean;
  /** Opens or collapses the tool panel. */
  onOpenChange: (open: boolean) => void;
  /** Hides the chat pane while the tools occupy the full workspace. */
  onMaximizedChange: (maximized: boolean) => void;
  /** Controlled maximize state, shared with the title-bar control. */
  maximized?: boolean;
  /** Keeps the title-bar as the single source of panel chrome in desktop. */
  showHeaderControls?: boolean;
  /** Opens a file in the shell's main viewer. */
  onOpenFile?: (path: string) => void;
}

const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_WIDTH = 640;
const RIGHT_PANEL_DEFAULT_WIDTH = 360;
const RIGHT_PANEL_WIDTH_KEY = "oc-right-tools-width";

function readPanelWidth(): number {
  try {
    const raw = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, value));
      }
    }
  } catch {
    // The panel remains usable when storage is unavailable.
  }
  return RIGHT_PANEL_DEFAULT_WIDTH;
}

function ReviewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      class="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 4.5h10.5L19 8v11.5H5z" />
      <path d="M15.5 4.5V8H19M8 12h8M8 15.5h5" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      class="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.5 9h17" />
    </svg>
  );
}

function BrowserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      class="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2 2.3 3 5.1 3 8.5s-1 6.2-3 8.5c-2-2.3-3-5.1-3-8.5s1-6.2 3-8.5z" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      class="h-4 w-4"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}

const RightToolPanel: Component<RightToolPanelProps> = (props) => {
  const t = useT();
  const [view, setView] = createSignal<RightToolView>("review");
  const [width, setWidth] = createSignal(readPanelWidth());
  const [internalMaximized, setInternalMaximized] = createSignal(false);
  const [browserUrl, setBrowserUrl] = createSignal("");
  const [browserTarget, setBrowserTarget] = createSignal("");
  let resizeStartX: number | null = null;
  let resizeStartWidth = RIGHT_PANEL_DEFAULT_WIDTH;
  const maximized = () => props.maximized ?? internalMaximized();

  function updateWidth(next: number): void {
    const value = Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, next));
    setWidth(value);
    try {
      localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(value));
    } catch {
      // Keep the live splitter working when persistence is unavailable.
    }
  }

  function stopResize(): void {
    resizeStartX = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  }

  function onResizeMove(event: PointerEvent): void {
    if (resizeStartX === null) return;
    // The splitter is on the panel's left edge, so dragging left widens it.
    updateWidth(resizeStartWidth - (event.clientX - resizeStartX));
  }

  function onResizeStart(event: PointerEvent): void {
    if (event.button !== 0 || !props.open || maximized()) return;
    event.preventDefault();
    resizeStartX = event.clientX;
    resizeStartWidth = width();
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function onResizeKeyDown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateWidth(width() + step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateWidth(width() - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      updateWidth(RIGHT_PANEL_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      updateWidth(RIGHT_PANEL_MAX_WIDTH);
    }
  }

  onCleanup(stopResize);

  function toggleMaximized(): void {
    const next = !maximized();
    if (props.maximized === undefined) setInternalMaximized(next);
    props.onMaximizedChange(next);
  }

  function submitBrowser(event: SubmitEvent): void {
    event.preventDefault();
    const value = browserUrl().trim();
    if (value === "") return;
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    setBrowserUrl(normalized);
    setBrowserTarget(normalized);
  }

  function openBrowserExternally(): void {
    const target = browserTarget();
    if (target === "") return;
    void openUrl(target).catch(() => {
      // The embedded page remains available when the system browser cannot be opened.
    });
  }

  return (
    <section
      data-testid="right-tool-panel"
      data-collapsed={props.open ? "false" : "true"}
      data-maximized={maximized() ? "true" : "false"}
      style={{ width: maximized() ? "100%" : props.open ? `${width()}px` : "32px" }}
      class={`relative flex min-h-0 min-w-0 flex-col border-l border-bg-sunken bg-bg-elevated transition-[width] duration-(--dur-med) ease-(--ease-emphasized) ${
        maximized() ? "flex-1" : "shrink-0"
      }`}
    >
      <Show
        when={props.open}
        fallback={
          <button
            type="button"
            data-testid="right-tools-expand"
            aria-label={t("desktop:openTools")}
            title={t("desktop:openTools")}
            aria-expanded="false"
            class="flex h-10 w-8 shrink-0 items-center justify-center text-fg-secondary outline-none transition-colors hover:bg-bg-sunken/70 hover:text-fg-primary"
            onClick={() => props.onOpenChange(true)}
          >
            <PanelIcon />
          </button>
        }
      >
        <div
          data-testid="right-tools-resize-handle"
          role="separator"
          aria-label={t("desktop:resizeTools")}
          aria-orientation="vertical"
          aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
          aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
          aria-valuenow={width()}
          tabIndex={0}
          class="group absolute inset-y-0 left-0 z-10 flex w-1 -translate-x-1/2 cursor-col-resize items-stretch justify-center bg-transparent outline-none hover:bg-accent-soft focus-visible:bg-accent-soft"
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
        >
          <span class="w-px bg-bg-sunken transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
        <header class="flex h-11 shrink-0 items-center gap-1 border-b border-bg-sunken px-2">
          <div
            role="tablist"
            aria-label={t("desktop:toolsView")}
            class="flex min-w-0 flex-1 items-center gap-0.5"
          >
            <button
              type="button"
              role="tab"
              data-testid="right-tools-review"
              aria-selected={view() === "review" ? "true" : "false"}
              aria-label={t("desktop:review")}
              title={t("desktop:review")}
              class={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs outline-none transition-colors ${
                view() === "review"
                  ? "bg-accent-soft text-fg-primary"
                  : "text-fg-secondary hover:bg-bg-sunken/70 hover:text-fg-primary"
              }`}
              onClick={() => setView("review")}
            >
              <ReviewIcon />
              <span class="truncate">{t("desktop:review")}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="right-tools-files"
              aria-selected={view() === "files" ? "true" : "false"}
              aria-label={t("desktop:filesTab")}
              title={t("desktop:filesTab")}
              class={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs outline-none transition-colors ${
                view() === "files"
                  ? "bg-accent-soft text-fg-primary"
                  : "text-fg-secondary hover:bg-bg-sunken/70 hover:text-fg-primary"
              }`}
              onClick={() => setView("files")}
            >
              <FilesIcon />
              <span class="truncate">{t("desktop:filesTab")}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="right-tools-browser"
              aria-selected={view() === "browser" ? "true" : "false"}
              aria-label={t("desktop:browser")}
              title={t("desktop:browser")}
              class={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs outline-none transition-colors ${
                view() === "browser"
                  ? "bg-accent-soft text-fg-primary"
                  : "text-fg-secondary hover:bg-bg-sunken/70 hover:text-fg-primary"
              }`}
              onClick={() => setView("browser")}
            >
              <BrowserIcon />
              <span class="truncate">{t("desktop:browser")}</span>
            </button>
          </div>
          <Show when={props.showHeaderControls !== false}>
            <button
              type="button"
              data-testid="right-tools-maximize"
              aria-label={maximized() ? t("desktop:restoreTools") : t("desktop:maximizeTools")}
              title={maximized() ? t("desktop:restoreTools") : t("desktop:maximizeTools")}
              aria-pressed={maximized() ? "true" : "false"}
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-secondary outline-none transition-colors hover:bg-bg-sunken/70 hover:text-fg-primary"
              onClick={toggleMaximized}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5" />
              </svg>
            </button>
            <button
              type="button"
              data-testid="right-tools-collapse"
              aria-label={t("desktop:closeTools")}
              title={t("desktop:closeTools")}
              aria-expanded="true"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-secondary outline-none transition-colors hover:bg-bg-sunken/70 hover:text-fg-primary"
              onClick={() => {
                if (maximized()) {
                  if (props.maximized === undefined) setInternalMaximized(false);
                  props.onMaximizedChange(false);
                }
                props.onOpenChange(false);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5" />
              </svg>
            </button>
          </Show>
        </header>

        <div class="min-h-0 flex-1 overflow-hidden">
          <Show when={view() === "review"}>
            <VcsPanel serverId={props.serverId} />
          </Show>
          <Show when={view() === "files"}>
            <div data-testid="right-tools-files-pane" class="h-full min-h-0">
              <FileViewer serverId={props.serverId} visible />
            </div>
          </Show>
          <Show when={view() === "browser"}>
            <div data-testid="right-tools-browser-pane" class="flex h-full min-h-0 flex-col p-3">
              <form class="flex shrink-0 items-center gap-2" onSubmit={submitBrowser}>
                <label class="sr-only" for="right-tools-browser-url">
                  {t("desktop:browserUrl")}
                </label>
                <input
                  id="right-tools-browser-url"
                  data-testid="right-tools-browser-url"
                  value={browserUrl()}
                  placeholder={t("desktop:browserUrlPlaceholder")}
                  class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs text-fg-primary outline-none placeholder:text-fg-faint focus:border-accent"
                  onInput={(event) => setBrowserUrl(event.currentTarget.value)}
                />
                <button
                  type="submit"
                  data-testid="right-tools-browser-go"
                  class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:border-fg-faint hover:text-fg-primary"
                >
                  {t("desktop:browserGo")}
                </button>
              </form>
              <Show
                when={browserTarget() !== ""}
                fallback={
                  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-fg-secondary">
                    <BrowserIcon />
                    <p class="text-sm">{t("desktop:browserEmpty")}</p>
                    <p class="text-xs text-fg-faint">{t("desktop:browserEmptyHint")}</p>
                  </div>
                }
              >
                <div class="flex min-h-0 flex-1 flex-col gap-2 pt-3">
                  <div class="flex shrink-0 items-center justify-between gap-2 px-1">
                    <p
                      class="min-w-0 truncate font-code text-xs text-fg-faint"
                      title={browserTarget()}
                    >
                      {browserTarget()}
                    </p>
                    <button
                      type="button"
                      data-testid="right-tools-browser-external"
                      class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1 text-xs text-fg-secondary outline-none transition-colors hover:border-fg-faint hover:text-fg-primary"
                      onClick={openBrowserExternally}
                    >
                      {t("desktop:browserOpenExternal")}
                    </button>
                  </div>
                  <iframe
                    data-testid="right-tools-browser-frame"
                    src={browserTarget()}
                    title={t("desktop:browserFrameTitle")}
                    sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts"
                    referrerpolicy="no-referrer"
                    class="min-h-0 min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-base"
                  />
                  <p class="shrink-0 px-1 text-[11px] text-fg-faint">
                    {t("desktop:browserFrameHint")}
                  </p>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
};

export default RightToolPanel;
