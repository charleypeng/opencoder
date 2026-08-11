// Working-directory picker (sessions add-directory flow): the dialog behind
// the project switcher's ➕ button. The server routes every request by its
// `directory` query (workspace-routing middleware), so the dialog browses
// the FILESYSTEM from the root "/" — GET /file?path=&directory=<dir> lists
// a directory's subfolders in that directory's own context — and lets the
// user drill down until the target folder is reached. "Add" sets that
// folder as the current working directory (project store `setCurrent`):
// DesktopShell rebuilds the per-directory SSE stream and re-syncs, so the
// folder's sessions load automatically. The dialog is a Kobalte modal.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { useT } from "../../i18n";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { createFileService, type FileNode } from "../../services/file";
import { createSessionService } from "../../services/session";
import { setCurrent } from "../../stores/project";
import { setActiveSession } from "../../stores/session";
import { pushRecentProject } from "./recentProjects";
import { createSession } from "./sessionActions";

export interface DirectoryPickerDialogProps {
  /** The server whose working directory is picked. */
  serverId: string;
  /** Closes the dialog (cancel / Esc / backdrop). */
  onClose: () => void;
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

const DirectoryPickerDialog: Component<DirectoryPickerDialogProps> = (props) => {
  const t = useT();
  /** The directory being browsed (its own subfolders are listed). */
  const [dir, setDir] = createSignal(ROOT);
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
  async function add(): Promise<void> {
    const target = dir();
    setCurrent(props.serverId, target);
    pushRecentProject(props.serverId, target);
    const service = createSessionService(getApiClient());
    try {
      // The client injects the new active directory, so this lists (and
      // creates in) the picked folder's own context.
      const list = await service.list();
      const sessions = Array.isArray(list) ? list : [];
      if (sessions.length === 0) {
        await createSession(props.serverId, service);
      } else {
        setActiveSession(props.serverId, sessions[0].id);
      }
    } catch {
      // The per-directory SSE re-sync settles the session list; a failure
      // here must not block the directory switch.
    }
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
            {t("sessions:directoryPickerTitle")}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-fg-secondary">
            {t("sessions:directoryPickerHint")}
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
              onClick={() => void add()}
              class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("sessions:directoryPickerAdd")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default DirectoryPickerDialog;
