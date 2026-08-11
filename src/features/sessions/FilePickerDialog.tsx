// Project directory picker (TASK-UI-01 filepicker): the dialog behind the
// sessions header "+" button. The user types a project directory path and
// gets LIVE suggestions from `GET /file?path=` — the children (subfolders
// and files) of the folder being typed, straight from the server's
// filesystem — instead of the previously-opened projects history. An empty
// input lists the workspace root; typing a path lists its parent directory
// and filters by the last segment (case-insensitive); clicking a folder
// browses into it; Enter picks the highlighted folder and creates the
// session there (POST /session?directory=), an empty input falls back to
// the plain new-session flow. The dialog is a Kobalte modal like the other
// session dialogs.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { useT } from "../../i18n";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { createFileService, type FileNode } from "../../services/file";
import { createSessionService, type Session } from "../../services/session";
import { createSession } from "./sessionActions";

export interface FilePickerDialogProps {
  /** The server that owns the new session. */
  serverId: string;
  /** Closes the dialog (cancel / Esc / backdrop). */
  onClose: () => void;
  /** A session was created in the picked directory. */
  onCreated: (session: Session) => void;
}

/** Splits the typed path into the directory to list (`cwd`, "" = the
 *  workspace root) and the name prefix to filter by. A trailing separator
 *  marks an explicit directory (shell-completion rule): the whole path is
 *  the cwd and no name filter applies. */
function parseQuery(raw: string): { cwd: string; segment: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { cwd: "", segment: "" };
  const explicitDir = /[\\/]$/.test(trimmed);
  const stripped = trimmed.replace(/[\\/]+$/, "");
  if (explicitDir) return { cwd: stripped, segment: "" };
  const idx = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"));
  if (idx === -1) return { cwd: "", segment: stripped };
  return { cwd: stripped.slice(0, idx), segment: stripped.slice(idx + 1) };
}

/** A directory icon + a document icon for the suggestion rows. */
function SuggestionIcon(props: { type: FileNode["type"] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`h-4 w-4 shrink-0 ${props.type === "directory" ? "text-fg-secondary" : "text-fg-faint"}`}
      aria-hidden="true"
    >
      {props.type === "directory" ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      ) : (
        <path d="M6 3h8l4 4v14H6z" />
      )}
    </svg>
  );
}

const FilePickerDialog: Component<FilePickerDialogProps> = (props) => {
  const t = useT();
  const [query, setQuery] = createSignal("");
  const [entries, setEntries] = createSignal<FileNode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  /** The directory whose children are listed ("" = the workspace root). */
  const cwd = createMemo(() => parseQuery(query()).cwd);

  // Fetch the current folder's listing whenever it changes (mount = root).
  // Stale responses are dropped via the sequence guard.
  let listSeq = 0;
  createEffect(() => {
    const dir = cwd();
    const seq = ++listSeq;
    setLoading(true);
    setLoadError(null);
    void createFileService(getApiClient())
      .tree(dir)
      .then((list) => {
        if (seq !== listSeq) return;
        setEntries(list);
        setLoading(false);
      })
      .catch((err) => {
        if (seq !== listSeq) return;
        setEntries([]);
        setLoadError(ApiError.fromUnknown(err).message);
        setLoading(false);
      });
  });

  /** Directories the input can complete to (files are shown but not
   *  pickable — a session needs a directory). */
  const selectable = createMemo<FileNode[]>(() => {
    const segment = parseQuery(query()).segment.toLowerCase();
    return entries().filter(
      (entry) =>
        entry.type === "directory" &&
        (segment === "" || entry.name.toLowerCase().startsWith(segment)),
    );
  });

  /** Full suggestion list: folders then files matching the segment. */
  const suggestions = createMemo<FileNode[]>(() => {
    const segment = parseQuery(query()).segment.toLowerCase();
    const dirs: FileNode[] = [];
    const files: FileNode[] = [];
    for (const entry of entries()) {
      if (segment !== "" && !entry.name.toLowerCase().startsWith(segment)) continue;
      (entry.type === "directory" ? dirs : files).push(entry);
    }
    return [...dirs, ...files];
  });

  /** Browses into a folder: fills the input with its absolute path so the
   *  listing follows, then restores focus to the input. */
  function browseInto(entry: FileNode): void {
    setQuery(`${entry.absolute}/`);
    setSelected(0);
    inputRef?.focus();
  }

  /** The directory the session is created in: an explicit (trailing-slash)
   *  input or the picked suggestion, else the raw typed path, else
   *  undefined for the plain new-session flow. */
  function effectiveDirectory(override?: string): string | undefined {
    if (override !== undefined) return override;
    const q = query().trim();
    if (q === "") return undefined;
    if (/[\\/]$/.test(q)) return q.replace(/[\\/]+$/, "");
    const list = selectable();
    if (selected() < list.length && list[selected()].absolute === q) return q;
    return q;
  }

  async function submit(directory?: string): Promise<void> {
    if (creating()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const session = await createSession(
        props.serverId,
        createSessionService(getApiClient()),
        effectiveDirectory(directory),
      );
      props.onCreated(session);
      props.onClose();
    } catch (err) {
      setCreateError(ApiError.fromUnknown(err).message);
      setCreating(false);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const list = selectable();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (list.length === 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selected() + delta + list.length) % list.length);
      return;
    }
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      // An explicit directory (trailing separator) creates as-is; otherwise
      // the highlighted folder is picked first, falling back to the raw
      // typed path.
      if (/[\\/]$/.test(query().trim())) {
        void submit();
        return;
      }
      const folder = list[Math.min(selected(), list.length - 1)];
      if (folder !== undefined) {
        setQuery(folder.absolute);
        void submit(folder.absolute);
      } else {
        void submit();
      }
    }
  }

  return (
    <Dialog.Root open onOpenChange={props.onClose}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="filepicker-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
        >
          <Dialog.Title class="text-md font-semibold">{t("sessions:filepickerTitle")}</Dialog.Title>
          <Dialog.Description class="text-sm text-fg-secondary">
            {t("sessions:filepickerHint")}
          </Dialog.Description>

          <input
            ref={inputRef}
            type="text"
            data-testid="filepicker-input"
            value={query()}
            placeholder={t("sessions:filepickerPlaceholder")}
            aria-label={t("sessions:filepickerPlaceholder")}
            disabled={creating()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            class="rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50"
          />

          <Show when={loading()}>
            <p data-testid="filepicker-loading" class="text-xs text-fg-secondary">
              {t("sessions:filepickerLoading")}
            </p>
          </Show>
          <Show when={loadError() !== null}>
            <p data-testid="filepicker-load-error" class="text-xs text-danger">
              {loadError()}
            </p>
          </Show>
          <Show when={!loading() && loadError() === null && suggestions().length === 0}>
            <p data-testid="filepicker-empty" class="text-xs text-fg-secondary">
              {t("sessions:filepickerNoMatches")}
            </p>
          </Show>
          <Show when={!loading() && suggestions().length > 0}>
            <ul data-testid="filepicker-suggestions" class="max-h-52 min-h-0 overflow-y-auto">
              <For each={suggestions()}>
                {(entry, index) => {
                  const isDir = entry.type === "directory";
                  const isSelected = () => selected() === index();
                  return (
                    <li>
                      <button
                        type="button"
                        data-testid={`filepicker-suggestion-${index()}`}
                        data-type={entry.type}
                        data-selected={isDir ? isSelected() : false}
                        aria-disabled={isDir ? undefined : "true"}
                        disabled={!isDir}
                        onClick={() => {
                          if (isDir) browseInto(entry);
                        }}
                        onMouseEnter={() => {
                          if (isDir) setSelected(index());
                        }}
                        class={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs outline-none ${
                          !isDir
                            ? "cursor-not-allowed opacity-60"
                            : isSelected()
                              ? "bg-accent-soft text-fg-primary"
                              : "text-fg-secondary hover:bg-accent-soft hover:text-fg-primary"
                        }`}
                      >
                        <SuggestionIcon type={entry.type} />
                        <span class="min-w-0 flex-1 truncate font-code">{entry.name}</span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>

          <Show when={createError() !== null}>
            <p data-testid="filepicker-create-error" class="text-xs text-danger">
              {createError()}
            </p>
          </Show>

          <div class="flex justify-end gap-2 pt-1">
            <Dialog.CloseButton
              data-testid="filepicker-cancel"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
            >
              {t("common:cancel")}
            </Dialog.CloseButton>
            <button
              type="button"
              data-testid="filepicker-create"
              disabled={creating()}
              onClick={() => void submit()}
              class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating() ? t("sessions:creating") : t("sessions:createSession")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default FilePickerDialog;
