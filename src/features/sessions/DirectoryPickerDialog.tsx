// Working-directory picker (sessions add-directory flow): for LOCAL servers
// (localhost / 127.0.0.1) the OS-level folder dialog opens first — the
// native picker returns a folder on THIS machine, which is exactly what a
// local server can use. Remote servers and environments without the native
// dialog fall back to the in-app browser below, which lists directories
// through the server itself (GET /file) and lets the user drill down until
// the target folder is reached. "Add" sets that folder as the current
// working directory (project store `setCurrent`): DesktopShell rebuilds
// the per-directory SSE stream and re-syncs, so the folder's sessions load
// automatically. The in-app browser is a Kobalte modal.

import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { open as openNativeDirectory } from "@tauri-apps/plugin-dialog";
import { useT } from "../../i18n";
import { listServers } from "../../services/servers";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { createFileService, type FileNode } from "../../services/file";
import { createSessionService } from "../../services/session";
import { setCurrent } from "../../stores/project";
import { pushRecentProject } from "./recentProjects";
import { ensureSessionInDirectory } from "./sessionActions";

export interface DirectoryPickerDialogProps {
  /** The server whose working directory is picked. */
  serverId: string;
  /** Closes the dialog (cancel / Esc / backdrop). */
  onClose: () => void;
  /**
   * The directory the browser starts from (defaults to the filesystem
   * root). Folder/session "open folder" actions pass the target directory
   * here so the dialog opens already positioned there.
   */
  initialDirectory?: string;
  /** Called with the added directory right before close (add flow) — the
   *  default-workspace flows use it to persist the choice. */
  onAdded?: (directory: string) => void;
  /** Overrides the title (default-workspace onboarding shows its own). */
  title?: string;
  /** Overrides the one-line hint below the title. */
  hint?: string;
  /** Shows a "Skip" button (first-entry onboarding may defer the choice). */
  showSkip?: boolean;
  /** Called when the user skips (defaults to onClose). */
  onSkip?: () => void;
}

/** The filesystem root the browser starts from. */
const ROOT = "/";

/** Joins a directory path and a child name (root-aware). */
function joinPath(dir: string, name: string): string {
  return dir === ROOT ? `/${name}` : `${dir}/${name}`;
}

/** Breadcrumb segments of a path: "/" plus every prefix below it. */
function crumbsOf(dir: string): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [{ label: ROOT, path: ROOT }];
  let acc = "";
  for (const segment of dir.split("/").filter((s) => s !== "")) {
    acc = acc === "" ? `/${segment}` : `${acc}/${segment}`;
    out.push({ label: segment, path: acc });
  }
  return out;
}

/** A folder icon for the directory rows. */
function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4 shrink-0 text-fg-secondary"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

/** The in-app filesystem browser (fallback): a Kobalte modal that lists
 *  directories via the server's GET /file endpoint and lets the user drill
 *  down to the target folder. */
function InAppDirectoryPicker(props: DirectoryPickerDialogProps) {
  const t = useT();
  /** The directory being browsed (its own subfolders are listed). Starts
   *  from the initialDirectory prop when given (open-folder flow), else
   *  the filesystem root. */
  const [dir, setDir] = createSignal(props.initialDirectory ?? ROOT);
  const [entries, setEntries] = createSignal<FileNode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const crumbs = createMemo(() => crumbsOf(dir()));

  // Fetch the browsed directory's subfolders (the explicit directory query
  // wins over the client's injected active directory — client.ts).
  let listSeq = 0;
  createEffect(() => {
    const target = dir();
    const seq = ++listSeq;
    setLoading(true);
    setLoadError(null);
    void createFileService(getApiClient())
      .tree("", target)
      .then((list) => {
        if (seq !== listSeq) return;
        setEntries(Array.isArray(list) ? list.filter((entry) => entry.type === "directory") : []);
        setLoading(false);
      })
      .catch((err) => {
        if (seq !== listSeq) return;
        setEntries([]);
        setLoadError(ApiError.fromUnknown(err).message);
        setLoading(false);
      });
  });

  function enter(entry: FileNode): void {
    setDir(joinPath(dir(), entry.name));
  }

  function jumpTo(path: string): void {
    if (path === dir()) return;
    setDir(path);
  }

  /** Adds the browsed directory as the working directory and jumps to it:
   *  DesktopShell reacts to the store change by rebuilding the per-directory
   *  SSE stream and re-syncing (loading the folder's sessions); if the
   *  folder has NO sessions yet, one is created in it right away — either
   *  way the picked directory becomes the active context with a session
   *  selected. The folder also lands in the switcher's recents (deduped). */
  async function add(target: string): Promise<void> {
    setCurrent(props.serverId, target);
    pushRecentProject(props.serverId, target);
    await ensureSessionInDirectory(props.serverId, createSessionService(getApiClient()));
    props.onAdded?.(target);
    props.onClose();
  }

  return (
    <Dialog.Root open onOpenChange={props.onClose}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="directory-picker-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
        >
          <Dialog.Title class="text-md font-semibold">
            {props.title ?? t("sessions:directoryPickerTitle")}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-fg-secondary">
            {props.hint ?? t("sessions:directoryPickerHint")}
          </Dialog.Description>

          {/* Breadcrumb: root plus every ancestor; clicking one jumps back. */}
          <nav
            data-testid="directory-picker-crumbs"
            aria-label={t("sessions:directoryPickerTitle")}
            class="flex shrink-0 items-center gap-1 overflow-x-auto rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1.5"
          >
            <For each={crumbs()}>
              {(crumb, index) => {
                const last = () => index() === crumbs().length - 1;
                return (
                  <Show
                    when={!last()}
                    fallback={
                      <span
                        data-testid={`directory-picker-crumb-${crumb.path || "root"}`}
                        data-current="true"
                        class="shrink-0 truncate font-code text-xs text-fg-primary"
                      >
                        {crumb.label}
                      </span>
                    }
                  >
                    <button
                      type="button"
                      data-testid={`directory-picker-crumb-${crumb.path || "root"}`}
                      class="shrink-0 rounded px-1 font-code text-xs text-fg-secondary outline-none hover:text-fg-primary focus:text-fg-primary"
                      onClick={() => jumpTo(crumb.path)}
                    >
                      {crumb.label} ›
                    </button>
                  </Show>
                );
              }}
            </For>
          </nav>

          <Show when={loading()}>
            <p data-testid="directory-picker-loading" class="text-xs text-fg-secondary">
              {t("sessions:directoryPickerLoading")}
            </p>
          </Show>
          <Show when={loadError() !== null}>
            <p data-testid="directory-picker-load-error" class="text-xs text-danger">
              {loadError()}
            </p>
          </Show>
          <Show when={!loading() && loadError() === null && entries().length === 0}>
            <p data-testid="directory-picker-empty" class="text-xs text-fg-secondary">
              {t("sessions:directoryPickerEmpty")}
            </p>
          </Show>
          <Show when={!loading() && entries().length > 0}>
            <ul data-testid="directory-picker-list" class="max-h-56 min-h-0 overflow-y-auto">
              <For each={entries()}>
                {(entry) => (
                  <li>
                    <button
                      type="button"
                      data-testid={`directory-picker-item-${entry.name}`}
                      onClick={() => enter(entry)}
                      class="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs text-fg-secondary outline-none hover:bg-accent-soft hover:text-fg-primary focus:bg-accent-soft focus:text-fg-primary"
                    >
                      <FolderIcon />
                      <span class="min-w-0 flex-1 truncate font-code">{entry.name}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <div class="flex items-center justify-end gap-2 pt-1">
            <Show when={props.showSkip}>
              <button
                type="button"
                data-testid="directory-picker-skip"
                onClick={() => (props.onSkip ?? props.onClose)()}
                class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
              >
                {t("sessions:skip")}
              </button>
            </Show>
            <Dialog.CloseButton
              data-testid="directory-picker-cancel"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
            >
              {t("common:cancel")}
            </Dialog.CloseButton>
            <button
              type="button"
              data-testid="directory-picker-add"
              disabled={loading() || loadError() !== null}
              onClick={() => void add(dir())}
              class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("sessions:directoryPickerAdd")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** True when the server URL points at the local machine (localhost /
 *  127.0.0.1 / [::1] with any port). Only LOCAL servers can share the
 *  client's filesystem, so the native OS folder picker is meaningful
 *  exclusively for them; remote servers keep the in-app browser. */
function isLocalServerUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Working-directory picker entry point (native-first for LOCAL servers):
 * when the server runs on the same machine (localhost / 127.0.0.1) the OS
 * folder picker opens immediately (macOS / Linux / Windows native dialog).
 * Remote servers, unavailable native dialogs (web/mobile/test builds) and
 * native failures all fall back to the in-app directory browser. The user
 * cancelling the native dialog closes the flow (it is not re-prompted).
 */
const DirectoryPickerDialog: Component<DirectoryPickerDialogProps> = (props) => {
  const [showInApp, setShowInApp] = createSignal(false);

  async function add(target: string): Promise<void> {
    setCurrent(props.serverId, target);
    pushRecentProject(props.serverId, target);
    await ensureSessionInDirectory(props.serverId, createSessionService(getApiClient()));
    props.onAdded?.(target);
    props.onClose();
  }

  onMount(() => {
    // Resolve the server's URL to decide the picker: native dialogs pick
    // a folder ON THIS MACHINE, so they only make sense for local servers.
    // The serverId is captured before the async work — the picker decides
    // once at mount, so reactivity is intentionally not tracked here.
    const serverId = props.serverId;
    void (async () => {
      try {
        const servers = await listServers();
        const server = servers.find((entry) => entry.id === serverId);
        if (server === undefined || !isLocalServerUrl(server.url)) {
          setShowInApp(true);
          return;
        }
        const picked = await openNativeDirectory({ directory: true, multiple: false });
        if (picked === null) {
          // The user cancelled the native dialog: the flow ends here.
          props.onClose();
          return;
        }
        await add(picked);
      } catch {
        // Registry or native dialog unavailable (web/mobile/test
        // environment): fall back to the in-app directory browser.
        setShowInApp(true);
      }
    })();
  });

  return <Show when={showInApp()}>{<InAppDirectoryPicker {...props} />}</Show>;
};

export default DirectoryPickerDialog;
