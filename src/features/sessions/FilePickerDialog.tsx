// Project directory picker (TASK-UI-01 filepicker): the dialog behind the
// sessions header "+" button. The user types a project directory path and
// gets live suggestions from `GET /project` (the directories OpenCode has
// actually opened) filtered by the input — worktree paths and names match
// case-insensitively. Enter or the "Create" button creates a session in
// the chosen directory (POST /session?directory=); picking a suggestion
// fills the input; an empty input falls back to the plain new-session
// flow. The dialog is a Kobalte modal like the other session dialogs.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { useT } from "../../i18n";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { createProjectService, type Project } from "../../services/project";
import { createSessionService, type Session } from "../../services/session";
import { createSession } from "./sessionActions";

export interface FilePickerDialogProps {
  /** The server that owns the new session. */
  serverId: string;
  /** Closes the dialog (cancel / Esc / backdrop). */
  onClose: () => void;
  /** A session was created in the picked directory. */
  onCreated: (session: Session) => void;
  /** Clock override for tests; defaults to the real wall clock. */
  nowMs?: number;
}

/** Path suggestions are shown for the full project list; filtering kicks in
 *  as soon as the user types (case-insensitive worktree/name match). */
function projectLabel(project: Project): string {
  return project.worktree ?? project.name ?? project.id;
}

const FilePickerDialog: Component<FilePickerDialogProps> = (props) => {
  const t = useT();
  const [query, setQuery] = createSignal("");
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal(0);

  onMount(() => {
    void createProjectService(getApiClient())
      .list()
      .then((list) => {
        setProjects(list);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(ApiError.fromUnknown(err).message);
        setLoading(false);
      });
  });

  const suggestions = createMemo<Project[]>(() => {
    const q = query().trim().toLowerCase();
    if (q === "") return projects();
    return projects().filter((project) => {
      const label = projectLabel(project).toLowerCase();
      return label.includes(q) || (project.name ?? "").toLowerCase().includes(q);
    });
  });

  /** The effective directory: the picked suggestion, else the raw input
   *  (trimmed), else undefined for the plain new-session flow. */
  function effectiveDirectory(): string | undefined {
    const q = query().trim();
    if (q === "") return undefined;
    const list = suggestions();
    if (selected() < list.length && projectLabel(list[selected()]) === q) {
      return projectLabel(list[selected()]);
    }
    return q;
  }

  function pick(project: Project): void {
    setQuery(projectLabel(project));
    setSelected(suggestions().findIndex((candidate) => candidate === project));
  }

  async function submit(): Promise<void> {
    if (creating()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const session = await createSession(
        props.serverId,
        createSessionService(getApiClient()),
        effectiveDirectory(),
      );
      props.onCreated(session);
      props.onClose();
    } catch (err) {
      setCreateError(ApiError.fromUnknown(err).message);
      setCreating(false);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const list = suggestions();
    if (list.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (selected() + delta + list.length) % list.length;
      setSelected(next);
      return;
    }
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const project = list[selected()];
      if (project !== undefined) pick(project);
      void submit();
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
            type="text"
            data-testid="filepicker-input"
            value={query()}
            placeholder={t("sessions:filepickerPlaceholder")}
            aria-label={t("sessions:filepickerPlaceholder")}
            disabled={creating()}
            onInput={(event) => setQuery(event.currentTarget.value)}
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
                {(project, index) => (
                  <li>
                    <button
                      type="button"
                      data-testid={`filepicker-suggestion-${index()}`}
                      data-selected={selected() === index()}
                      onClick={() => pick(project)}
                      onMouseEnter={() => setSelected(index())}
                      class={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs outline-none ${
                        selected() === index()
                          ? "bg-accent-soft text-fg-primary"
                          : "text-fg-secondary hover:bg-accent-soft hover:text-fg-primary"
                      }`}
                    >
                      <span class="min-w-0 flex-1 truncate font-code">{projectLabel(project)}</span>
                      <Show when={project.vcs}>
                        <span class="shrink-0 rounded-sm bg-bg-sunken px-1 py-0.5 font-mono text-[10px] text-fg-faint">
                          {project.vcs}
                        </span>
                      </Show>
                    </button>
                  </li>
                )}
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
