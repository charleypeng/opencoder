// Diagnostics settings section (TASK-M9-07): the frontend error/warn log
// console (bounded ring buffer fed by the app-wide window.onerror +
// console hooks, with a level filter and a clear action), the log-forward
// toggle (persisted `oc-diagnostics` pref; captured error/warn entries are
// flushed to POST /log on batch/interval/stop), the server version readout
// with the outdated-server hint (M8-09's `installation.update-available`
// store) and the saved permission rules list (GET/DELETE
// /api/permission/saved, V2 directory) with per-row confirm-then-delete.
// POST /global/upgrade is intentionally NOT offered: the spec is
// display-only — the server upgrades itself, the app only hints at a
// restart.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { useT } from "../../../i18n/index.js";
import { getApiClient } from "../../../services/client.js";
import { createPermissionService, type PermissionSavedInfo } from "../../../services/permission.js";
import { connections } from "../../../stores/connection.js";
import { serverUpdate } from "../../../stores/serverUpdate.js";
import {
  clearLogEntries,
  logCapture,
  subscribeToLogEntries,
  type CapturedLevel,
  type CapturedLogEntry,
} from "./logCapture.js";
import { forwardLogsEnabled, setLogForwarding } from "./logForward.js";

export type LogLevelFilter = "all" | CapturedLevel;

const FILTER_LABEL: Record<LogLevelFilter, string> = {
  all: "settings:diagLogAll",
  error: "settings:diagLogLevelError",
  warn: "settings:diagLogLevelWarn",
};

export interface DiagnosticsSectionProps {
  /** The server whose version and saved permission rules are shown. */
  serverId: string;
}

const DiagnosticsSection: Component<DiagnosticsSectionProps> = (props) => {
  const t = useT();
  const [logs, setLogs] = createSignal<CapturedLogEntry[]>([...logCapture.entries]);
  const [levelFilter, setLevelFilter] = createSignal<LogLevelFilter>("all");
  const [forwarding, setForwarding] = createSignal(forwardLogsEnabled());
  const [rules, setRules] = createSignal<PermissionSavedInfo[] | null>(null);
  const [rulesError, setRulesError] = createSignal<string | null>(null);
  /** Rule id whose delete button is armed (second click deletes). */
  const [deleteArmed, setDeleteArmed] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  onMount(() => {
    const unsubscribe = subscribeToLogEntries((entry) => {
      setLogs((entries) => [...entries, entry]);
    });
    onCleanup(unsubscribe);
    const service = createPermissionService(getApiClient());
    service
      .savedList()
      .then((list) => setRules(list.data))
      .catch((err) => {
        setRulesError(err instanceof Error ? err.message : String(err));
      });
  });

  const filteredLogs = createMemo(() => {
    const filter = levelFilter();
    if (filter === "all") return [...logs()].reverse();
    return logs()
      .filter((entry) => entry.level === filter)
      .reverse();
  });

  const health = () => connections[props.serverId];
  const update = () => serverUpdate[props.serverId];

  async function removeRule(rule: PermissionSavedInfo): Promise<void> {
    if (deleteArmed() !== rule.id) {
      setDeleteArmed(rule.id);
      setDeleteError(null);
      return;
    }
    setDeleteArmed(null);
    setDeleting(rule.id);
    setDeleteError(null);
    try {
      await createPermissionService(getApiClient()).savedRemove(rule.id);
      setRules((current) => (current ?? []).filter((entry) => entry.id !== rule.id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  }

  function toggleForwarding(): void {
    const next = !forwarding();
    setForwarding(next);
    setLogForwarding(next);
  }

  return (
    <div data-testid="diagnostics-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:diagnostics")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:diagnosticsHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Server version + outdated hint (display-only; the server
            upgrades itself, see TASK-M9-07 spec). */}
        <div
          data-testid="diag-server"
          class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3"
        >
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:diagServerVersion")}</p>
            <Show
              when={update() !== undefined}
              fallback={
                <p class="mt-0.5 text-xs text-fg-secondary">
                  {t("settings:diagServerUpToDate", { version: health()?.version ?? "—" })}
                </p>
              }
            >
              <p data-testid="diag-server-update" class="mt-0.5 text-xs text-fg-secondary">
                {t("settings:diagServerUpdateHint", {
                  version: update()!.version,
                  current: update()!.current ?? health()?.version ?? "—",
                })}
              </p>
            </Show>
          </div>
          <span
            data-testid="diag-server-version"
            class="shrink-0 font-code text-xs text-fg-secondary"
          >
            {health()?.version ?? "—"}
          </span>
        </div>

        {/* Log forwarding toggle. */}
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:diagForwardLogs")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:diagForwardLogsHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="diag-forward-toggle"
            aria-checked={forwarding() ? "true" : "false"}
            aria-label={t("settings:diagForwardLogs")}
            onClick={toggleForwarding}
            class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors ${
              forwarding() ? "bg-accent" : "bg-bg-sunken"
            }`}
          >
            <span
              class={`absolute top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
                forwarding() ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Frontend log console. */}
        <div
          data-testid="diag-log-console"
          class="flex min-h-0 flex-col border-b border-bg-sunken py-3"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-medium">{t("settings:diagLogConsole")}</p>
            <div class="flex items-center gap-1">
              <For each={["all", "error", "warn"] as const}>
                {(level) => (
                  <button
                    type="button"
                    data-testid={`diag-log-filter-${level}`}
                    aria-pressed={levelFilter() === level ? "true" : "false"}
                    class={`rounded-md px-2 py-0.5 text-xs outline-none transition-colors ${
                      levelFilter() === level
                        ? "bg-accent-soft text-fg-primary"
                        : "text-fg-secondary hover:text-fg-primary"
                    }`}
                    onClick={() => setLevelFilter(level)}
                  >
                    {t(FILTER_LABEL[level])}
                  </button>
                )}
              </For>
              <button
                type="button"
                data-testid="diag-log-clear"
                class="rounded-md px-2 py-0.5 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
                onClick={() => {
                  clearLogEntries();
                  setLogs([]);
                }}
              >
                {t("settings:diagLogClear")}
              </button>
            </div>
          </div>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:diagLogConsoleHint")}</p>
          <div class="mt-2 max-h-56 overflow-y-auto rounded-md border border-bg-sunken bg-bg-sunken/40 font-code text-xs">
            <Show
              when={filteredLogs().length > 0}
              fallback={
                <p data-testid="diag-log-empty" class="p-3 text-fg-faint">
                  {t("settings:diagLogsEmpty")}
                </p>
              }
            >
              <For each={filteredLogs()}>
                {(entry) => (
                  <div
                    data-testid="diag-log-entry"
                    data-level={entry.level}
                    class="flex gap-2 border-b border-bg-sunken px-3 py-1.5 last:border-b-0"
                  >
                    <span
                      class={`shrink-0 uppercase ${
                        entry.level === "error" ? "text-danger" : "text-warning"
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span class="shrink-0 text-fg-faint">
                      {new Date(entry.time).toLocaleTimeString()}
                    </span>
                    <span class="min-w-0 break-all text-fg-secondary">{entry.message}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Saved permission rules. */}
        <div data-testid="diag-rules" class="py-3">
          <p class="text-xs font-medium">{t("settings:diagSavedPermissions")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:diagSavedPermissionsHint")}</p>
          <Show when={rulesError() !== null}>
            <p data-testid="diag-rules-error" class="mt-2 text-xs text-danger">
              {t("settings:diagRulesLoadFailed", { detail: rulesError() })}
            </p>
          </Show>
          <Show
            when={Array.isArray(rules()) && (rules() as PermissionSavedInfo[]).length > 0}
            fallback={
              <Show
                when={rules() === null}
                fallback={
                  <p data-testid="diag-rules-empty" class="mt-2 text-xs text-fg-faint">
                    {t("settings:diagRulesEmpty")}
                  </p>
                }
              >
                <p data-testid="diag-rules-loading" class="mt-2 text-xs text-fg-faint">
                  {t("settings:diagRulesLoading")}
                </p>
              </Show>
            }
          >
            <ul class="mt-2 space-y-1">
              <For each={rules() as PermissionSavedInfo[]}>
                {(rule) => (
                  <li
                    data-testid="diag-rule"
                    class="flex items-center justify-between gap-2 rounded-md border border-bg-sunken px-3 py-1.5"
                  >
                    <div class="min-w-0">
                      <p class="truncate text-xs">
                        <span data-testid={`diag-rule-action-${rule.id}`} class="font-medium">
                          {rule.action}
                        </span>{" "}
                        <span data-testid={`diag-rule-resource-${rule.id}`} class="font-code">
                          {rule.resource}
                        </span>
                      </p>
                      <p class="truncate text-xs text-fg-faint">{rule.projectID}</p>
                    </div>
                    <button
                      type="button"
                      data-testid={`diag-rule-delete-${rule.id}`}
                      disabled={deleting() !== null}
                      class={`shrink-0 rounded-md border px-2 py-1 text-xs outline-none transition-colors disabled:opacity-50 ${
                        deleteArmed() === rule.id
                          ? "border-danger bg-danger text-fg-primary"
                          : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:border-fg-faint hover:text-fg-primary"
                      }`}
                      onClick={() => void removeRule(rule)}
                    >
                      {deleteArmed() === rule.id
                        ? t("settings:diagRuleConfirm")
                        : t("settings:diagRuleDelete")}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={deleteError() !== null}>
            <p data-testid="diag-rule-error" class="mt-2 text-xs text-danger">
              {t("settings:diagRuleDeleteFailed", { detail: deleteError() })}
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsSection;
