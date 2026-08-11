// Config settings section (TASK-M9-05): project-level and global OpenCode
// config editors. Scope tabs (project / global) load GET /config or
// GET /global/config; the common fields (model / default_agent / share /
// autoupdate / permission) are formified, the rest is editable through the
// advanced JSON editor. Verified against the 1.18.11 contract:
//   - the Config schema has NO `theme` key (additionalProperties: false —
//     the server rejects unknown keys; theme is a client-side preference,
//     TASK-M9-03), so the form only renders fields that exist
//   - PATCH /config merges a deep partial into the stored config and
//     answers the full updated config; the JSON editor therefore applies
//     the edited JSON as a merge patch (omitted fields stay unchanged)
// Saving is PATCH-on-demand with dirty tracking (form edits enable Save,
// success refreshes the baseline + toasts, failure rolls back and shows
// the error inline); the JSON editor validates parseability inline and
// warns about unknown top-level keys before applying. The model dual
// select is form-driven once a pick exists (provider changes re-list the
// new provider's models immediately and the model onChange writes the
// form's provider, so a save can never pair a model with a stale
// provider); in-flight save responses are dropped when the scope tab
// flipped meanwhile, and switching scope with a dirty form asks for
// confirmation before discarding the picks. The danger zone
// offers POST /instance/dispose behind a confirm panel — disposing the
// CONNECTED instance shuts the server down, so the SSE stream drops and
// the app falls back to the server list (the connection is not
// re-established by this section).

import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { Dialog } from "@kobalte/core";
import { createToast } from "../../../stores/toasts.js";
import { useT } from "../../../i18n/index.js";
import { getApiClient } from "../../../services/client.js";
import { createConfigService, type Config, type ConfigPatch } from "../../../services/config.js";
import { createAgentService, type Agent } from "../../../services/agent.js";
import { createProviderService, type Provider } from "../../../services/provider.js";
import {
  getServerModelState,
  setConfigDefault,
  setProviders,
  type ModelRef,
} from "../../../stores/models.js";
import { readAutoTitleEnabled, setAutoTitleEnabled } from "../../sessions/autoTitle.js";

export type ConfigScope = "project" | "global";

/** The 36 top-level Config keys of the 1.18.11 contract — the JSON editor
 *  warns about any other key (additionalProperties: false server-side). */
const KNOWN_CONFIG_KEYS = new Set<string>([
  "$schema",
  "shell",
  "logLevel",
  "server",
  "command",
  "skills",
  "references",
  "reference",
  "watcher",
  "snapshot",
  "plugin",
  "share",
  "autoshare",
  "autoupdate",
  "disabled_providers",
  "enabled_providers",
  "model",
  "small_model",
  "default_agent",
  "subagent_depth",
  "username",
  "mode",
  "agent",
  "provider",
  "mcp",
  "formatter",
  "lsp",
  "instructions",
  "layout",
  "permission",
  "tools",
  "attachment",
  "enterprise",
  "tool_output",
  "compaction",
  "experimental",
]);

const SHARE_OPTIONS = ["manual", "auto", "disabled"] as const;
const AUTOUPDATE_OPTIONS = ["true", "false", "notify"] as const;
const PERMISSION_OPTIONS = ["ask", "allow", "deny"] as const;
/** Resolves a config `model` string ("gpt-5" or "openai/gpt-5") to a
 *  catalog reference, or null when the model is not in the provider
 *  catalog (the raw string is then shown read-only). */
export function modelRefOf(
  configModel: string | undefined,
  providers: Provider[],
): ModelRef | null {
  if (configModel === undefined || configModel === "") return null;
  const slash = configModel.indexOf("/");
  if (slash > 0) {
    const providerID = configModel.slice(0, slash);
    const modelID = configModel.slice(slash + 1);
    const provider = providers.find((entry) => entry.id === providerID);
    if (provider !== undefined && provider.models[modelID] !== undefined) {
      return { providerID, modelID };
    }
  }
  for (const provider of providers) {
    if (provider.models[configModel] !== undefined) {
      return { providerID: provider.id, modelID: configModel };
    }
  }
  return null;
}

/** The qualified config model string written back on change; the server
 *  accepts "provider/model" and resolves it to the same model. */
export function configModelString(ref: ModelRef): string {
  return `${ref.providerID}/${ref.modelID}`;
}

interface ConfigForm {
  model: ModelRef | null;
  defaultAgent: string;
  share: "" | (typeof SHARE_OPTIONS)[number];
  autoupdate: "" | (typeof AUTOUPDATE_OPTIONS)[number];
  permission: "" | (typeof PERMISSION_OPTIONS)[number];
}

function formOf(config: Config): ConfigForm {
  return {
    model: null,
    defaultAgent: typeof config.default_agent === "string" ? config.default_agent : "",
    share: typeof config.share === "string" ? config.share : "",
    autoupdate:
      config.autoupdate === true
        ? "true"
        : config.autoupdate === false
          ? "false"
          : config.autoupdate === "notify"
            ? "notify"
            : "",
    permission: typeof config.permission === "string" ? config.permission : "",
  };
}

export interface ConfigSectionProps {
  /** The server whose config is edited. */
  serverId: string;
}

const selectClass =
  "min-w-0 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1.5 " +
  "text-sm text-fg-primary outline-none focus:border-fg-faint";

const ConfigSection: Component<ConfigSectionProps> = (props) => {
  const t = useT();
  const [scope, setScope] = createSignal<ConfigScope>("project");
  const [config, setConfig] = createSignal<Config | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [form, setForm] = createSignal<ConfigForm>({
    model: null,
    defaultAgent: "",
    share: "",
    autoupdate: "",
    permission: "",
  });
  const [formDirty, setFormDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [agents, setAgents] = createSignal<Agent[] | null>(null);
  const [jsonText, setJsonText] = createSignal("");
  const [jsonEdit, setJsonEdit] = createSignal(false);
  const [jsonError, setJsonError] = createSignal<string | null>(null);
  const [jsonUnknown, setJsonUnknown] = createSignal<string[] | null>(null);
  const [jsonSaving, setJsonSaving] = createSignal(false);
  const [jsonSaveError, setJsonSaveError] = createSignal<string | null>(null);
  const [confirmDispose, setConfirmDispose] = createSignal(false);
  const [disposing, setDisposing] = createSignal(false);
  const [disposeError, setDisposeError] = createSignal<string | null>(null);
  /** The scope tab whose switch awaits the discard confirmation (a dirty
   *  form would otherwise be silently lost on the switch). */
  const [pendingScope, setPendingScope] = createSignal<ConfigScope | null>(null);
  // "AI generated title" (client preference, default ON — the 1.18.11
  // Config schema has no title-generation key, so it is never written to
  // opencode.json; see autoTitle.ts).
  const [autoTitleOn, setAutoTitleOn] = createSignal(readAutoTitleEnabled());

  const service = createConfigService(getApiClient());
  const modelState = createMemo(() => getServerModelState(props.serverId));

  /** Baseline application: resets the form and the JSON editor to a loaded
   *  config (load + both save paths share this). */
  function applyConfig(cfg: Config): void {
    setConfig(cfg);
    setForm(formOf(cfg));
    setFormDirty(false);
    setSaveError(null);
    setJsonText(JSON.stringify(cfg, null, 2));
    setJsonError(null);
    setJsonUnknown(null);
    setJsonSaveError(null);
  }

  async function load(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      const cfg = scope() === "project" ? await service.get() : await service.getGlobal();
      if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
        throw new Error("Unexpected response format");
      }
      applyConfig(cfg as Config);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever the scope tab flips; the initial load runs on mount.
  createEffect(on(scope, () => void load()));

  // One-shot catalog + agent list fetch on mount (per-server, scope-
  // independent); failures leave the pickers in their fallback states.
  // The per-instance guard fires the fetch at most once (a later store
  // change must not re-fetch).
  let catalogFetchAttempted = false;
  createEffect(() => {
    if (catalogFetchAttempted) return;
    catalogFetchAttempted = true;
    const serverId = props.serverId;
    void Promise.allSettled([
      createProviderService(getApiClient()).list(),
      createProviderService(getApiClient()).configProviders(),
      createAgentService(getApiClient()).list(),
    ]).then(([list, providerDefaults, agentList]) => {
      if (list.status === "fulfilled") setProviders(serverId, list.value);
      if (
        providerDefaults.status === "fulfilled" &&
        providerDefaults.value?.default !== undefined
      ) {
        setConfigDefault(serverId, providerDefaults.value.default);
      }
      if (agentList.status === "fulfilled") setAgents(agentList.value);
    });
  });

  const resolvedModel = createMemo(() => modelRefOf(config()?.model, modelState().providers));

  // The selects are form-driven once a pick exists: the baseline only
  // seeds them while the form is clean, so a provider change switches the
  // model list immediately and the model onChange can never pair a model
  // with a stale provider id.
  const selectedModel = createMemo(() => form().model ?? resolvedModel());

  const providers = createMemo(() => modelState().providers);
  const provider = createMemo(
    () => providers().find((entry) => entry.id === selectedModel()?.providerID) ?? null,
  );
  const models = createMemo(() => (provider() === null ? [] : Object.values(provider()!.models)));

  // The agent options load asynchronously, so a `value` binding alone would
  // clamp to "" while the list is empty and never re-apply. Re-applying the
  // form value whenever the agent list or the form changes keeps the
  // select truthful (the onChange path makes this a no-op on user picks).
  let agentSelectRef: HTMLSelectElement | undefined;
  createEffect(() => {
    void agents();
    const el = agentSelectRef;
    const next = form().defaultAgent;
    if (el !== undefined && el.value !== next) el.value = next;
  });

  function markDirty(): void {
    setFormDirty(true);
    setSaveError(null);
  }

  function changeModel(ref: ModelRef): void {
    setForm({ ...form(), model: ref });
    markDirty();
  }

  function changeProvider(id: string): void {
    const next = providers().find((entry) => entry.id === id);
    const first = next === undefined ? undefined : Object.values(next.models)[0];
    if (first !== undefined) changeModel({ providerID: id, modelID: first.id });
  }

  /** Builds the merge patch from the form: keys the form owns, only when a
   *  value is actually set (empty = leave the server value untouched). */
  function patchOf(): ConfigPatch {
    const patch: ConfigPatch = {};
    const current = form();
    if (current.model !== null) patch.model = configModelString(current.model);
    if (current.defaultAgent !== "") patch.default_agent = current.defaultAgent;
    if (current.share !== "") patch.share = current.share;
    if (current.autoupdate !== "") {
      patch.autoupdate =
        current.autoupdate === "true" ? true : current.autoupdate === "false" ? false : "notify";
    }
    if (current.permission !== "") patch.permission = current.permission;
    return patch;
  }

  async function saveForm(): Promise<void> {
    const target = scope();
    setSaving(true);
    setSaveError(null);
    try {
      const updated =
        target === "project"
          ? await service.update(patchOf())
          : await service.updateGlobal(patchOf());
      // The scope tab may have flipped while the PATCH was in flight — the
      // new scope's load owns the baseline then, so a stale response must
      // not overwrite it (and must not toast into the new scope either).
      if (scope() !== target) return;
      applyConfig(updated);
      createToast(t("settings:configSaved"), "success");
    } catch (err) {
      if (scope() !== target) return;
      setSaveError(err instanceof Error ? err.message : String(err));
      setFormDirty(true);
    } finally {
      setSaving(false);
    }
  }

  function parseJson(text: string): Record<string, unknown> | null {
    setJsonError(null);
    setJsonUnknown(null);
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("expected a JSON object");
      }
      const keys = Object.keys(parsed);
      setJsonUnknown(keys.filter((key) => !KNOWN_CONFIG_KEYS.has(key)));
      return parsed as Record<string, unknown>;
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** Live edit: the textarea value updates and re-validates on every keystroke
   *  (parse errors + unknown-key hints surface inline, blocking save). */
  function editJson(text: string): void {
    setJsonText(text);
    parseJson(text);
  }

  async function saveJson(): Promise<void> {
    const parsed = parseJson(jsonText());
    if (parsed === null) return;
    const target = scope();
    setJsonSaving(true);
    setJsonSaveError(null);
    try {
      const updated =
        target === "project"
          ? await service.update(parsed as ConfigPatch)
          : await service.updateGlobal(parsed as ConfigPatch);
      if (scope() !== target) return;
      applyConfig(updated);
      setJsonEdit(false);
      createToast(t("settings:configJsonSaved"), "success");
    } catch (err) {
      if (scope() !== target) return;
      // Failure rollback: the textarea returns to the last-saved config.
      const last = config();
      if (last !== null) setJsonText(JSON.stringify(last, null, 2));
      setJsonSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setJsonSaving(false);
    }
  }

  function cancelJson(): void {
    const last = config();
    if (last !== null) setJsonText(JSON.stringify(last, null, 2));
    setJsonEdit(false);
    setJsonError(null);
    setJsonUnknown(null);
    setJsonSaveError(null);
  }

  async function dispose(): Promise<void> {
    setDisposing(true);
    setDisposeError(null);
    try {
      await service.dispose();
      setConfirmDispose(false);
      createToast(t("settings:configDisposed"), "success");
    } catch (err) {
      setDisposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisposing(false);
    }
  }

  /** Switching scope with a dirty form would silently discard the picks,
   *  so the switch is deferred behind a confirmation dialog instead. */
  function requestScope(next: ConfigScope): void {
    if (next === scope() || !formDirty()) {
      setScope(next);
      return;
    }
    setPendingScope(next);
  }

  function confirmScopeSwitch(): void {
    const next = pendingScope();
    if (next === null) return;
    setPendingScope(null);
    setScope(next);
  }

  function row(label: string, hint: string | undefined, control: JSX.Element, testId: string) {
    return (
      <div data-testid={testId} class="border-b border-bg-sunken py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{label}</p>
            {hint !== undefined ? <p class="mt-0.5 text-xs text-fg-secondary">{hint}</p> : null}
          </div>
          <div class="max-w-[45%] shrink-0">{control}</div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="config-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:config")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:configHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex gap-2 border-b border-bg-sunken pb-3">
          <button
            type="button"
            data-testid="config-scope-project"
            aria-pressed={scope() === "project" ? "true" : "false"}
            onClick={() => requestScope("project")}
            class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
              scope() === "project"
                ? "border-accent bg-accent-soft text-fg-primary"
                : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {t("settings:configScopeProject")}
          </button>
          <button
            type="button"
            data-testid="config-scope-global"
            aria-pressed={scope() === "global" ? "true" : "false"}
            onClick={() => requestScope("global")}
            class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
              scope() === "global"
                ? "border-accent bg-accent-soft text-fg-primary"
                : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {t("settings:configScopeGlobal")}
          </button>
        </div>

        <Show when={loading() && config() === null} fallback={null}>
          <p data-testid="config-loading" class="py-3 text-xs text-fg-secondary">
            {t("settings:configLoading")}
          </p>
        </Show>
        <Show when={loadError() !== null}>
          <div class="flex items-center gap-2 py-3">
            <p data-testid="config-load-error" class="min-w-0 flex-1 text-xs text-danger">
              {t("settings:configLoadFailed", { detail: loadError() })}
            </p>
            <button
              type="button"
              data-testid="config-retry"
              onClick={() => void load()}
              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
            >
              {t("settings:configRetry")}
            </button>
          </div>
        </Show>

        <Show when={config() !== null}>
          {row(
            t("settings:configModel"),
            t("settings:configModelHint"),
            <Show
              when={providers().length > 0}
              fallback={<span class="text-xs text-fg-faint">—</span>}
            >
              <Show
                when={resolvedModel() !== null}
                fallback={
                  <span
                    data-testid="config-model-unresolved"
                    class="block max-w-[12rem] truncate text-xs text-fg-secondary"
                  >
                    {t("settings:configModelUnresolved", { model: config()?.model ?? "" })}
                  </span>
                }
              >
                <div class="flex items-center gap-2">
                  <select
                    data-testid="config-model-provider"
                    aria-label={t("models:providerLabel")}
                    class={selectClass}
                    value={selectedModel()?.providerID ?? ""}
                    onChange={(event) => changeProvider(event.currentTarget.value)}
                  >
                    <For each={providers()}>
                      {(entry) => <option value={entry.id}>{entry.name}</option>}
                    </For>
                  </select>
                  <select
                    data-testid="config-model-model"
                    aria-label={t("models:modelLabel")}
                    class={selectClass}
                    value={selectedModel()?.modelID ?? ""}
                    onChange={(event) => {
                      const pid = selectedModel()?.providerID;
                      if (pid !== undefined)
                        changeModel({ providerID: pid, modelID: event.currentTarget.value });
                    }}
                  >
                    <For each={models()}>
                      {(entry) => <option value={entry.id}>{entry.name ?? entry.id}</option>}
                    </For>
                  </select>
                </div>
              </Show>
            </Show>,
            "config-row-model",
          )}

          {row(
            t("settings:configDefaultAgent"),
            t("settings:configDefaultAgentHint"),
            <select
              ref={agentSelectRef}
              data-testid="config-agent"
              aria-label={t("settings:configDefaultAgent")}
              class={selectClass}
              onChange={(event) => {
                setForm({ ...form(), defaultAgent: event.currentTarget.value });
                markDirty();
              }}
            >
              <option value="">{t("settings:configNotSet")}</option>
              <For each={agents() ?? []}>
                {(agent) => <option value={agent.name}>{agent.name}</option>}
              </For>
              <Show
                when={
                  form().defaultAgent !== "" &&
                  !(agents() ?? []).some((agent) => agent.name === form().defaultAgent)
                }
              >
                <option value={form().defaultAgent}>{form().defaultAgent}</option>
              </Show>
            </select>,
            "config-row-agent",
          )}

          {row(
            t("settings:configShare"),
            t("settings:configShareHint"),
            <select
              data-testid="config-share"
              aria-label={t("settings:configShare")}
              class={selectClass}
              value={form().share}
              onChange={(event) => {
                setForm({ ...form(), share: event.currentTarget.value as ConfigForm["share"] });
                markDirty();
              }}
            >
              <option value="">{t("settings:configNotSet")}</option>
              <For each={SHARE_OPTIONS}>
                {(option) => (
                  <option value={option}>
                    {t(`settings:configShare${option.charAt(0).toUpperCase()}${option.slice(1)}`)}
                  </option>
                )}
              </For>
            </select>,
            "config-row-share",
          )}

          {row(
            t("settings:configAutoupdate"),
            t("settings:configAutoupdateHint"),
            <select
              data-testid="config-autoupdate"
              aria-label={t("settings:configAutoupdate")}
              class={selectClass}
              value={form().autoupdate}
              onChange={(event) => {
                setForm({
                  ...form(),
                  autoupdate: event.currentTarget.value as ConfigForm["autoupdate"],
                });
                markDirty();
              }}
            >
              <option value="">{t("settings:configNotSet")}</option>
              <For each={AUTOUPDATE_OPTIONS}>
                {(option) => (
                  <option value={option}>
                    {t(
                      `settings:configAutoupdate${option.charAt(0).toUpperCase()}${option.slice(1)}`,
                    )}
                  </option>
                )}
              </For>
            </select>,
            "config-row-autoupdate",
          )}

          {row(
            t("settings:configPermission"),
            t("settings:configPermissionHint"),
            <Show
              when={typeof config()?.permission === "string"}
              fallback={
                <p
                  data-testid="config-permission-object"
                  class="max-w-[16rem] text-xs text-fg-secondary"
                >
                  {t("settings:configPermissionObject")}
                </p>
              }
            >
              <select
                data-testid="config-permission"
                aria-label={t("settings:configPermission")}
                class={selectClass}
                value={form().permission}
                onChange={(event) => {
                  setForm({
                    ...form(),
                    permission: event.currentTarget.value as ConfigForm["permission"],
                  });
                  markDirty();
                }}
              >
                <option value="">{t("settings:configNotSet")}</option>
                <For each={PERMISSION_OPTIONS}>
                  {(option) => (
                    <option value={option}>
                      {t(
                        `settings:configPermission${option.charAt(0).toUpperCase()}${option.slice(1)}`,
                      )}
                    </option>
                  )}
                </For>
              </select>
            </Show>,
            "config-row-permission",
          )}

          {/* "AI generated title" lives in the GLOBAL config scope only
              (client preference — see autoTitle.ts; it never touches
              opencode.json because the contract has no such key). */}
          <Show when={scope() === "global"}>
            {row(
              t("settings:configAutoTitle"),
              t("settings:configAutoTitleHint"),
              <label class="flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  data-testid="config-auto-title"
                  aria-label={t("settings:configAutoTitle")}
                  checked={autoTitleOn()}
                  onChange={(event) => {
                    const next = event.currentTarget.checked;
                    setAutoTitleEnabled(next);
                    setAutoTitleOn(next);
                  }}
                  class="h-4 w-4 accent-accent"
                />
              </label>,
              "config-row-auto-title",
            )}
          </Show>

          <div class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
              <Show when={formDirty()}>
                <p data-testid="config-dirty" class="text-xs text-fg-secondary">
                  {t("settings:configDirty")}
                </p>
              </Show>
            </div>
            <button
              type="button"
              data-testid="config-save"
              disabled={!formDirty() || saving()}
              onClick={() => void saveForm()}
              class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-fg-primary outline-none transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
            >
              {saving() ? t("settings:configSaving") : t("settings:configSave")}
            </button>
          </div>
          <Show when={saveError() !== null}>
            <p data-testid="config-save-error" class="pb-3 text-xs text-danger">
              {t("settings:configSaveFailed", { detail: saveError() })}
            </p>
          </Show>

          <div class="border-t border-bg-sunken py-3">
            <p class="text-xs font-medium">{t("settings:configAdvanced")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:configAdvancedHint")}</p>
            <Show
              when={jsonEdit()}
              fallback={
                <div>
                  <pre
                    data-testid="config-json-view"
                    class="mt-2 max-h-56 overflow-auto rounded-md border border-bg-sunken bg-bg-sunken p-2 font-code text-[11px] leading-relaxed text-fg-secondary"
                  >
                    {jsonText()}
                  </pre>
                  <button
                    type="button"
                    data-testid="config-json-edit"
                    onClick={() => setJsonEdit(true)}
                    class="mt-2 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-primary outline-none transition-colors hover:border-fg-faint"
                  >
                    {t("settings:configJsonEdit")}
                  </button>
                </div>
              }
            >
              <div>
                <textarea
                  data-testid="config-json-textarea"
                  aria-label={t("settings:configAdvanced")}
                  value={jsonText()}
                  onInput={(event) => editJson(event.currentTarget.value)}
                  spellcheck={false}
                  class="mt-2 h-56 w-full resize-y rounded-md border border-bg-sunken bg-bg-sunken p-2 font-code text-[11px] leading-relaxed text-fg-primary outline-none focus:border-fg-faint"
                />
                <Show when={jsonError() !== null}>
                  <p data-testid="config-json-parse-error" class="mt-1 text-xs text-danger">
                    {t("settings:configJsonInvalid", { detail: jsonError() })}
                  </p>
                </Show>
                <Show when={jsonUnknown() !== null && jsonUnknown()!.length > 0}>
                  <p data-testid="config-json-unknown-keys" class="mt-1 text-xs text-warning">
                    {t("settings:configJsonUnknownKeys", { keys: jsonUnknown()!.join(", ") })}
                  </p>
                </Show>
                <Show when={jsonSaveError() !== null}>
                  <p data-testid="config-json-save-error" class="mt-1 text-xs text-danger">
                    {t("settings:configJsonSaveFailed", { detail: jsonSaveError() })}
                  </p>
                </Show>
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    data-testid="config-json-save"
                    disabled={jsonSaving() || jsonError() !== null}
                    onClick={() => void saveJson()}
                    class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-fg-primary outline-none transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
                  >
                    {jsonSaving() ? t("settings:configSaving") : t("settings:configSave")}
                  </button>
                  <button
                    type="button"
                    data-testid="config-json-cancel"
                    disabled={jsonSaving()}
                    onClick={cancelJson}
                    class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                  >
                    {t("settings:configJsonCancel")}
                  </button>
                </div>
              </div>
            </Show>
          </div>

          <div data-testid="config-danger-zone" class="border-t border-bg-sunken py-3">
            <p class="text-xs font-medium text-danger">{t("settings:configDangerZone")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:configDisposeHint")}</p>
            <Show
              when={!confirmDispose()}
              fallback={
                <div
                  data-testid="config-dispose-panel"
                  class="mt-2 rounded-md border border-danger/40 bg-danger/5 p-3"
                >
                  <p class="text-xs text-fg-primary">{t("settings:configDisposeExplain")}</p>
                  <div class="mt-2 flex gap-2">
                    <button
                      type="button"
                      data-testid="config-dispose-confirm"
                      disabled={disposing()}
                      onClick={() => void dispose()}
                      class="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-fg-primary outline-none transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
                    >
                      {disposing()
                        ? t("settings:configDisposing")
                        : t("settings:configDisposeConfirm")}
                    </button>
                    <button
                      type="button"
                      data-testid="config-dispose-cancel"
                      disabled={disposing()}
                      onClick={() => setConfirmDispose(false)}
                      class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                    >
                      {t("settings:configDisposeCancel")}
                    </button>
                  </div>
                  <Show when={disposeError() !== null}>
                    <p data-testid="config-dispose-error" class="mt-2 text-xs text-danger">
                      {t("settings:configDisposeFailed", { detail: disposeError() })}
                    </p>
                  </Show>
                </div>
              }
            >
              <button
                type="button"
                data-testid="config-dispose"
                onClick={() => setConfirmDispose(true)}
                class="mt-2 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:border-danger/50 hover:text-danger"
              >
                {t("settings:configDispose")}
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <Dialog.Root
        open={pendingScope() !== null}
        onOpenChange={(open) => {
          if (!open) setPendingScope(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="config-discard-dialog"
            class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
          >
            <Dialog.Title class="text-md font-semibold">
              {t("settings:configDiscardDirtyTitle")}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-fg-secondary">
              {t("settings:configDiscardDirtyExplain")}
            </Dialog.Description>
            <div class="flex justify-end gap-2 pt-1">
              <Dialog.CloseButton
                data-testid="config-discard-cancel"
                class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
              >
                {t("common:cancel")}
              </Dialog.CloseButton>
              <button
                type="button"
                data-testid="config-discard-confirm"
                onClick={confirmScopeSwitch}
                class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-fg-primary outline-none hover:opacity-90"
              >
                {t("settings:configDiscardDirtyConfirm")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default ConfigSection;
