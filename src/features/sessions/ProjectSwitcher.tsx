// Project/folder switcher (TASK-M2-03): the sidebar top section. Loads the
// server's project list into the project store, tracks the active directory
// (highlighted in the menu), remembers recently switched projects per server
// (localStorage) and switches context by calling setCurrent — DesktopShell
// reacts by rebuilding the per-directory SSE stream and re-syncing the
// stores, so session lists and messages never mix across directories.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { DropdownMenu } from "@kobalte/core";
import { getApiClient } from "../../services/client";
import { createProjectService, type Project } from "../../services/project";
import { applyProjects, getServerProjectState, setCurrent } from "../../stores/project";
import { pushRecentProject, readRecentProjects } from "./recentProjects";
import DirectoryPickerDialog from "./DirectoryPickerDialog.js";
import { useT } from "../../i18n";

export interface ProjectSwitcherProps {
  /** The server whose projects are shown. */
  serverId: string;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function projectLabel(
  project: Project | null,
  directory: string | null,
  selectLabel: string,
): string {
  if (project?.name) return project.name;
  if (project) return basename(project.worktree);
  if (directory) return basename(directory);
  return selectLabel;
}

const itemClass =
  "flex w-full flex-col rounded-sm px-3 py-1.5 text-left outline-none " +
  "hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft";

const sectionClass = "px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-fg-faint";

const ProjectSwitcher: Component<ProjectSwitcherProps> = (props) => {
  const t = useT();
  const selectLabel = () => t("sessions:selectProject");
  const state = createMemo(() => getServerProjectState(props.serverId));
  const currentDirectory = createMemo(() => state().current);
  const currentProject = createMemo(() => {
    const dir = currentDirectory();
    if (dir === null) return null;
    return state().projects.find((p) => p.worktree === dir) ?? null;
  });
  const [recent, setRecent] = createSignal<string[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  // The add-directory dialog (sessions ➕ in the menu header) and the
  // controlled menu state (the ➕ closes the menu before opening the dialog).
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);

  async function load(serverId: string) {
    const service = createProjectService(getApiClient());
    try {
      const [list, current] = await Promise.all([service.list(), service.current()]);
      applyProjects(serverId, list);
      const directory = current?.worktree ?? null;
      // Only touch the context when it actually changed, so an unrelated
      // load (e.g. a re-sync) never triggers an SSE rebuild in DesktopShell.
      if (getServerProjectState(serverId).current !== directory) {
        setCurrent(serverId, directory);
      }
    } catch {
      // Unreachable server: keep the previous state; the next
      // server.connected re-sync heals the store.
    } finally {
      setLoaded(true);
    }
  }

  createEffect(() => {
    const serverId = props.serverId;
    setRecent(readRecentProjects(serverId));
    setLoaded(false);
    void load(serverId);
  });

  function select(directory: string, current: string | null) {
    if (directory === current) return;
    setCurrent(props.serverId, directory);
    setRecent(pushRecentProject(props.serverId, directory));
  }

  return (
    <div data-testid="project-switcher" class="border-b border-bg-sunken px-3 py-2">
      <DropdownMenu.Root open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-testid="project-switcher-trigger"
          aria-label={t("sessions:switchProject")}
          class="flex w-full items-center justify-between gap-2 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-left outline-none hover:border-fg-faint focus:border-fg-faint"
        >
          <span class="flex min-w-0 flex-col">
            <Show
              when={currentDirectory() !== null}
              fallback={<span class="text-sm text-fg-secondary">{selectLabel()}</span>}
            >
              <span class="truncate text-sm font-medium">
                {projectLabel(currentProject(), currentDirectory(), selectLabel())}
              </span>
              <span class="truncate font-code text-xs text-fg-secondary">{currentDirectory()}</span>
            </Show>
          </span>
          <span aria-hidden="true" class="shrink-0 text-xs text-fg-secondary">
            ▾
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="glass z-50 max-h-80 min-w-56 overflow-y-auto p-1">
            {/* Menu header: the ➕ opens the add-directory browser (it closes
                the menu first so the dialog floats above the sidebar). */}
            <div class="flex items-center justify-end border-b border-bg-sunken px-1 pb-1">
              <button
                type="button"
                data-testid="project-switcher-add"
                aria-label={t("sessions:addDirectory")}
                title={t("sessions:addDirectory")}
                onClick={() => {
                  setMenuOpen(false);
                  setPickerOpen(true);
                }}
                class="rounded-md px-1.5 py-0.5 text-sm text-fg-secondary outline-none hover:bg-accent-soft hover:text-fg-primary focus:bg-accent-soft focus:text-fg-primary"
              >
                ＋
              </button>
            </div>
            <Show when={recent().length > 0}>
              <div data-testid="project-switcher-recent" class={sectionClass}>
                {t("sessions:recentProjects")}
              </div>
              <For each={recent()}>
                {(dir) => {
                  const project = () => state().projects.find((p) => p.worktree === dir) ?? null;
                  return (
                    <DropdownMenu.Item
                      data-testid={`project-switcher-recent-${project()?.id ?? basename(dir)}`}
                      data-active={dir === currentDirectory() ? "true" : "false"}
                      aria-current={dir === currentDirectory() ? "true" : undefined}
                      class={itemClass}
                      onSelect={() => select(dir, currentDirectory())}
                    >
                      <span class="truncate text-sm">
                        {projectLabel(project(), dir, selectLabel())}
                      </span>
                      <span class="truncate font-code text-xs text-fg-secondary">{dir}</span>
                    </DropdownMenu.Item>
                  );
                }}
              </For>
              <Show when={state().projects.length > 0}>
                <div class="mx-3 my-1 border-t border-bg-sunken" />
              </Show>
            </Show>
            <Show
              when={state().projects.length > 0}
              fallback={
                <Show when={loaded()}>
                  <div data-testid="project-switcher-empty" class="px-3 py-4 text-center">
                    <p class="text-sm text-fg-secondary">{t("sessions:noProjects")}</p>
                    <p class="mt-1 text-xs text-fg-faint">{t("sessions:noProjectsHint")}</p>
                  </div>
                </Show>
              }
            >
              <div data-testid="project-switcher-all" class={sectionClass}>
                {t("sessions:allProjects")}
              </div>
              <For each={state().projects}>
                {(project) => {
                  const active = project.worktree === currentDirectory();
                  return (
                    <DropdownMenu.Item
                      data-testid={`project-switcher-item-${project.id}`}
                      data-active={active ? "true" : "false"}
                      aria-current={active ? "true" : undefined}
                      class={itemClass}
                      onSelect={() => select(project.worktree, currentDirectory())}
                    >
                      <span class="truncate text-sm">
                        {project.name ?? basename(project.worktree)}
                      </span>
                      <span class="truncate font-code text-xs text-fg-secondary">
                        {project.worktree}
                      </span>
                    </DropdownMenu.Item>
                  );
                }}
              </For>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Add-directory browser (sessions ➕ in the menu header). */}
      <Show when={pickerOpen()}>
        <DirectoryPickerDialog serverId={props.serverId} onClose={() => setPickerOpen(false)} />
      </Show>
    </div>
  );
};

export default ProjectSwitcher;
