// MCP settings section (TASK-M9-06): lists the server's MCP servers as
// status cards (GET /mcp — the per-server MCPStatus union of the 1.18.11
// contract: connected | failed+error | disabled | needs_auth |
// needs_client_registration+error; the status carries NO tools field, so
// the cards show the state + error detail but no tool counts), offers
// connect/disconnect control (POST /mcp/{name}/connect + disconnect) and
// an Add dialog (POST /mcp with the local { type:"local", command:[],
// environment? } or remote { type:"remote", url, headers? } config union),
// and an Authorize flow (McpOAuthDialog) for needs_auth servers. The
// `mcp.tools.changed` SSE event carries only the server name — it bumps
// the mcp store version and the section refetches the status list. The
// contract has NO DELETE /mcp/{name} endpoint, so there is no remove
// button. Per-server actions lock globally while any mutation is in flight
// (same discipline as ProviderKeys).

import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { createToast } from "../../../stores/toasts.js";
import { useT } from "../../../i18n/index.js";
import { getApiClient } from "../../../services/client.js";
import {
  createMcpService,
  type McpAddInput,
  type McpStatus,
  type McpStatusMap,
} from "../../../services/mcp.js";
import { getMcpVersion } from "../../../stores/mcp.js";
import McpOAuthDialog from "./McpOAuthDialog.js";

export interface McpSectionProps {
  /** The server whose MCP servers are managed. */
  serverId: string;
}

export type McpAddKind = "local" | "remote";

export interface KeyValueRow {
  key: string;
  value: string;
}

/** Splits a full command line into the contract's command: string[] (the
 *  executable plus its args). */
export function commandArray(commandLine: string): string[] {
  return commandLine.split(/\s+/).filter((part) => part !== "");
}

/** Collapses key/value rows into the config's record (empty keys drop). */
export function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() !== "") record[row.key.trim()] = row.value;
  }
  return record;
}

const McpSection: Component<McpSectionProps> = (props) => {
  const t = useT();
  const service = createMcpService(getApiClient());
  const [servers, setServers] = createSignal<McpStatusMap | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  /** Server with a connect/disconnect mutation in flight (locks every row). */
  const [busy, setBusy] = createSignal<string | null>(null);
  /** Per-server action errors (connect/disconnect failures). */
  const [actionErrors, setActionErrors] = createSignal<Record<string, string>>({});
  /** Server whose error detail is expanded. */
  const [expandedError, setExpandedError] = createSignal<string | null>(null);
  const [addOpen, setAddOpen] = createSignal(false);
  const [addKind, setAddKind] = createSignal<McpAddKind>("local");
  const [addName, setAddName] = createSignal("");
  const [addCommand, setAddCommand] = createSignal("");
  const [addUrl, setAddUrl] = createSignal("");
  const [envRows, setEnvRows] = createSignal<KeyValueRow[]>([{ key: "", value: "" }]);
  const [headerRows, setHeaderRows] = createSignal<KeyValueRow[]>([{ key: "", value: "" }]);
  const [adding, setAdding] = createSignal(false);
  const [addError, setAddError] = createSignal<string | null>(null);
  /** Server whose OAuth dialog is open. */
  const [oauthTarget, setOauthTarget] = createSignal<string | null>(null);

  let fetchVersion = 0;
  async function load(): Promise<void> {
    const version = ++fetchVersion;
    setLoading(true);
    setLoadError(null);
    try {
      const map = await service.list();
      if (version !== fetchVersion) return;
      setServers(map);
    } catch (err) {
      if (version !== fetchVersion) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (version === fetchVersion) setLoading(false);
    }
  }

  // The initial effect run loads the list; the mcp.tools.changed SSE event
  // (routed into the mcp store, TASK-M9-06) bumps the server's version and
  // the effect refetches the status map on the bump. The source keys on the
  // server id too, so switching servers reloads even when both versions
  // happen to match.
  createEffect(
    on(
      () => `${props.serverId}:${getMcpVersion(props.serverId)}`,
      () => void load(),
    ),
  );

  const sortedNames = createMemo(() => Object.keys(servers() ?? {}).sort());

  function statusOf(name: string): McpStatus | undefined {
    return servers()?.[name];
  }

  function statusKind(status: McpStatus | undefined): string {
    if (status === undefined) return "unknown";
    return status.status;
  }

  /** True when any mutation is in flight — every row's actions lock then
   *  (concurrent connect/disconnect would race the shared status list). */
  const anyBusy = createMemo(() => busy() !== null);

  async function connect(name: string): Promise<void> {
    if (busy() !== null) return;
    setBusy(name);
    setActionErrors((errors) => ({ ...errors, [name]: "" }));
    try {
      await service.connect(name);
      await load();
    } catch (err) {
      setActionErrors((errors) => ({
        ...errors,
        [name]: t("settings:mcpConnectFailed", {
          name,
          detail: err instanceof Error ? err.message : String(err),
        }),
      }));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(name: string): Promise<void> {
    if (busy() !== null) return;
    setBusy(name);
    setActionErrors((errors) => ({ ...errors, [name]: "" }));
    try {
      await service.disconnect(name);
      await load();
    } catch (err) {
      setActionErrors((errors) => ({
        ...errors,
        [name]: t("settings:mcpDisconnectFailed", {
          name,
          detail: err instanceof Error ? err.message : String(err),
        }),
      }));
    } finally {
      setBusy(null);
    }
  }

  function openAdd(): void {
    setAddOpen(true);
    setAddKind("local");
    setAddName("");
    setAddCommand("");
    setAddUrl("");
    setEnvRows([{ key: "", value: "" }]);
    setHeaderRows([{ key: "", value: "" }]);
    setAddError(null);
  }

  const addValid = createMemo(() => {
    if (addName().trim() === "") return false;
    return addKind() === "local" ? addCommand().trim() !== "" : addUrl().trim() !== "";
  });

  async function submitAdd(): Promise<void> {
    if (!addValid() || adding()) return;
    setAdding(true);
    setAddError(null);
    try {
      const env = rowsToRecord(envRows());
      const headers = rowsToRecord(headerRows());
      const config: McpAddInput["config"] =
        addKind() === "local"
          ? {
              type: "local",
              command: commandArray(addCommand()),
              ...(Object.keys(env).length > 0 && { environment: env }),
            }
          : {
              type: "remote",
              url: addUrl().trim(),
              ...(Object.keys(headers).length > 0 && { headers }),
            };
      const map = await service.add({ name: addName().trim(), config });
      setServers(map);
      setAddOpen(false);
      createToast(t("settings:mcpAdded"), "success");
    } catch (err) {
      setAddError(
        t("settings:mcpAddFailed", { detail: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setAdding(false);
    }
  }

  function badgeClass(kind: string): string {
    switch (kind) {
      case "connected":
        return "border-accent/40 text-accent";
      case "failed":
      case "needs_client_registration":
        return "border-danger/40 text-danger";
      case "needs_auth":
        return "border-warning/40 text-warning";
      default:
        return "border-bg-sunken text-fg-faint";
    }
  }

  function badgeLabel(kind: string): string {
    switch (kind) {
      case "connected":
        return t("settings:mcpStatusConnected");
      case "failed":
        return t("settings:mcpStatusFailed");
      case "needs_auth":
        return t("settings:mcpStatusNeedsAuth");
      case "needs_client_registration":
        return t("settings:mcpStatusNeedsRegistration");
      default:
        return t("settings:mcpStatusDisabled");
    }
  }

  const errorDetail = (status: McpStatus | undefined): string | null => {
    if (status === undefined) return null;
    if (status.status === "failed" || status.status === "needs_client_registration") {
      return status.error;
    }
    return null;
  };

  function actionFor(name: string, status: McpStatus | undefined) {
    const kind = statusKind(status);
    if (kind === "connected") {
      return (
        <button
          type="button"
          data-testid={`mcp-disconnect-${name}`}
          disabled={anyBusy()}
          onClick={() => void disconnect(name)}
          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy() === name ? t("settings:mcpDisconnecting") : t("settings:mcpDisconnect")}
        </button>
      );
    }
    if (kind === "needs_auth") {
      return (
        <button
          type="button"
          data-testid={`mcp-authorize-${name}`}
          disabled={anyBusy()}
          onClick={() => setOauthTarget(name)}
          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("settings:mcpAuthorize")}
        </button>
      );
    }
    return (
      <button
        type="button"
        data-testid={`mcp-connect-${name}`}
        disabled={anyBusy()}
        onClick={() => void connect(name)}
        class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy() === name ? t("settings:mcpConnecting") : t("settings:mcpConnect")}
      </button>
    );
  }

  const inputClass =
    "min-w-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none " +
    "placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50";

  function envRowsControl() {
    return (
      <div class="mt-1 flex flex-col gap-1.5">
        <For each={envRows()}>
          {(row, index) => (
            <div class="flex items-center gap-1.5">
              <input
                data-testid={`mcp-env-key-${index()}`}
                type="text"
                value={row.key}
                aria-label={t("settings:mcpEnvKey")}
                onInput={(event) =>
                  setEnvRows((rows) =>
                    rows.map((entry, i) =>
                      i === index() ? { ...entry, key: event.currentTarget.value } : entry,
                    ),
                  )
                }
                class={inputClass}
                placeholder={t("settings:mcpEnvKey")}
              />
              <input
                data-testid={`mcp-env-value-${index()}`}
                type="text"
                value={row.value}
                aria-label={t("settings:mcpEnvValue")}
                onInput={(event) =>
                  setEnvRows((rows) =>
                    rows.map((entry, i) =>
                      i === index() ? { ...entry, value: event.currentTarget.value } : entry,
                    ),
                  )
                }
                class={inputClass}
                placeholder={t("settings:mcpEnvValue")}
              />
              <button
                type="button"
                data-testid={`mcp-env-remove-${index()}`}
                aria-label={t("settings:mcpEnvRemove")}
                disabled={adding()}
                onClick={() => setEnvRows((rows) => rows.filter((_, i) => i !== index()))}
                class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1.5 text-xs text-fg-secondary outline-none hover:text-danger disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          )}
        </For>
        <button
          type="button"
          data-testid="mcp-env-add"
          disabled={adding()}
          onClick={() => setEnvRows((rows) => [...rows, { key: "", value: "" }])}
          class="w-fit rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:opacity-50"
        >
          {t("settings:mcpAddRow")}
        </button>
      </div>
    );
  }

  function headersControl() {
    return (
      <div class="mt-1 flex flex-col gap-1.5">
        <For each={headerRows()}>
          {(row, index) => (
            <div class="flex items-center gap-1.5">
              <input
                data-testid={`mcp-header-key-${index()}`}
                type="text"
                value={row.key}
                aria-label={t("settings:mcpHeaderKey")}
                onInput={(event) =>
                  setHeaderRows((rows) =>
                    rows.map((entry, i) =>
                      i === index() ? { ...entry, key: event.currentTarget.value } : entry,
                    ),
                  )
                }
                class={inputClass}
                placeholder={t("settings:mcpHeaderKey")}
              />
              <input
                data-testid={`mcp-header-value-${index()}`}
                type="text"
                value={row.value}
                aria-label={t("settings:mcpHeaderValue")}
                onInput={(event) =>
                  setHeaderRows((rows) =>
                    rows.map((entry, i) =>
                      i === index() ? { ...entry, value: event.currentTarget.value } : entry,
                    ),
                  )
                }
                class={inputClass}
                placeholder={t("settings:mcpHeaderValue")}
              />
              <button
                type="button"
                data-testid={`mcp-header-remove-${index()}`}
                aria-label={t("settings:mcpHeaderRemove")}
                disabled={adding()}
                onClick={() => setHeaderRows((rows) => rows.filter((_, i) => i !== index()))}
                class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1.5 text-xs text-fg-secondary outline-none hover:text-danger disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          )}
        </For>
        <button
          type="button"
          data-testid="mcp-header-add"
          disabled={adding()}
          onClick={() => setHeaderRows((rows) => [...rows, { key: "", value: "" }])}
          class="w-fit rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:opacity-50"
        >
          {t("settings:mcpAddRow")}
        </button>
      </div>
    );
  }

  return (
    <section data-testid="mcp-section" class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div class="flex items-baseline justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold">{t("settings:mcp")}</h2>
          <p class="text-xs text-fg-secondary">{t("settings:mcpHint")}</p>
        </div>
        <Show when={!loadError()}>
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-testid="mcp-refresh"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
              onClick={() => void load()}
            >
              {t("common:refresh")}
            </button>
            <button
              type="button"
              data-testid="mcp-add"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
              onClick={openAdd}
            >
              {t("settings:mcpAdd")}
            </button>
          </div>
        </Show>
      </div>

      <Show when={loading() && servers() === null}>
        <p data-testid="mcp-loading" class="py-3 text-xs text-fg-secondary">
          {t("settings:mcpLoading")}
        </p>
      </Show>

      <Show when={loadError() !== null}>
        <div class="flex items-center gap-2 py-3">
          <p data-testid="mcp-load-error" class="min-w-0 flex-1 text-xs text-danger">
            {t("settings:mcpLoadFailed", { detail: loadError() })}
          </p>
          <button
            type="button"
            data-testid="mcp-retry"
            onClick={() => void load()}
            class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
          >
            {t("common:retry")}
          </button>
        </div>
      </Show>

      <Show
        when={servers() !== null && Object.keys(servers()!).length > 0}
        fallback={
          <Show when={!loading() && loadError() === null && servers() !== null}>
            <p data-testid="mcp-empty" class="py-3 text-xs text-fg-faint">
              {t("settings:mcpEmpty")}
            </p>
          </Show>
        }
      >
        <ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <For each={sortedNames()}>
            {(name) => {
              const status = () => statusOf(name);
              const kind = () => statusKind(status());
              const errorText = () => errorDetail(status());
              const expanded = () => expandedError() === name;
              return (
                <li
                  data-testid={`mcp-server-${name}`}
                  data-status={kind()}
                  class="rounded-md border border-bg-sunken bg-bg-elevated p-3"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <h3 class="truncate text-sm font-medium">{name}</h3>
                      <span
                        data-testid={`mcp-status-${name}`}
                        class={`rounded border px-1.5 py-px text-[10px] ${badgeClass(kind())}`}
                      >
                        {badgeLabel(kind())}
                      </span>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      <Show when={errorText() !== null}>
                        <button
                          type="button"
                          data-testid={`mcp-error-toggle-${name}`}
                          onClick={() => setExpandedError(expanded() ? null : name)}
                          class="rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1 text-[10px] text-fg-secondary outline-none hover:text-fg-primary"
                        >
                          {expanded() ? t("settings:mcpHideError") : t("settings:mcpShowError")}
                        </button>
                      </Show>
                      {actionFor(name, status())}
                    </div>
                  </div>

                  <Show when={expanded() && errorText() !== null}>
                    <pre
                      data-testid={`mcp-error-${name}`}
                      class="mt-2 max-h-40 overflow-auto rounded-md border border-bg-sunken bg-bg-sunken p-2 font-code text-[11px] leading-relaxed text-danger"
                    >
                      {errorText()}
                    </pre>
                  </Show>
                  <Show when={actionErrors()[name]}>
                    <p data-testid={`mcp-action-error-${name}`} class="mt-1.5 text-xs text-danger">
                      {actionErrors()[name]}
                    </p>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>

      <Show when={oauthTarget() !== null}>
        <McpOAuthDialog
          serverName={oauthTarget()!}
          onClose={() => setOauthTarget(null)}
          onAuthorized={() => void load()}
        />
      </Show>

      <Dialog.Root
        open={addOpen()}
        onOpenChange={(open) => {
          if (!open && !adding()) setAddOpen(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="mcp-add-dialog"
            class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
          >
            <Dialog.Title class="text-md font-semibold">{t("settings:mcpAddTitle")}</Dialog.Title>

            <div class="flex gap-2">
              <button
                type="button"
                data-testid="mcp-add-tab-local"
                aria-pressed={addKind() === "local" ? "true" : "false"}
                onClick={() => setAddKind("local")}
                class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
                  addKind() === "local"
                    ? "border-accent bg-accent-soft text-fg-primary"
                    : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {t("settings:mcpAddLocal")}
              </button>
              <button
                type="button"
                data-testid="mcp-add-tab-remote"
                aria-pressed={addKind() === "remote" ? "true" : "false"}
                onClick={() => setAddKind("remote")}
                class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
                  addKind() === "remote"
                    ? "border-accent bg-accent-soft text-fg-primary"
                    : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {t("settings:mcpAddRemote")}
              </button>
            </div>

            <div class="flex flex-col gap-2">
              <input
                data-testid="mcp-add-name"
                type="text"
                value={addName()}
                placeholder={t("settings:mcpName")}
                aria-label={t("settings:mcpName")}
                disabled={adding()}
                onInput={(event) => setAddName(event.currentTarget.value)}
                class={inputClass}
              />

              <Show when={addKind() === "local"} fallback={null}>
                <input
                  data-testid="mcp-add-command"
                  type="text"
                  value={addCommand()}
                  placeholder={t("settings:mcpCommand")}
                  aria-label={t("settings:mcpCommand")}
                  disabled={adding()}
                  onInput={(event) => setAddCommand(event.currentTarget.value)}
                  class={inputClass}
                />
                <p class="text-[10px] text-fg-faint">{t("settings:mcpCommandHint")}</p>
                <p class="text-xs font-medium">{t("settings:mcpEnvironment")}</p>
                {envRowsControl()}
              </Show>

              <Show when={addKind() === "remote"} fallback={null}>
                <input
                  data-testid="mcp-add-url"
                  type="text"
                  value={addUrl()}
                  placeholder={t("settings:mcpUrl")}
                  aria-label={t("settings:mcpUrl")}
                  disabled={adding()}
                  onInput={(event) => setAddUrl(event.currentTarget.value)}
                  class={inputClass}
                />
                <p class="text-xs font-medium">{t("settings:mcpHeaders")}</p>
                {headersControl()}
              </Show>
            </div>

            <Show when={addError() !== null}>
              <p data-testid="mcp-add-error" class="text-xs text-danger">
                {addError()}
              </p>
            </Show>

            <div class="flex justify-end gap-2 pt-1">
              <Dialog.CloseButton
                data-testid="mcp-add-cancel"
                class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
              >
                {t("common:cancel")}
              </Dialog.CloseButton>
              <button
                type="button"
                data-testid="mcp-add-submit"
                disabled={!addValid() || adding()}
                onClick={() => void submitAdd()}
                class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-fg-primary outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {adding() ? t("settings:mcpAdding") : t("settings:mcpAdd")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
};

export default McpSection;
