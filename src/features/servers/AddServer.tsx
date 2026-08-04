// Add Server wizard (TASK-M1-05): name/URL/optional-auth form with a live
// "Test connection" probe (probe_server → GET /global/health), URL
// normalization, a plain-HTTP risk warning and save via add_server.

import { createSignal, Show } from "solid-js";
import { ApiError } from "../../services/errors";
import { addServer, probeServer, updateServer } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";
import { isRemotePlainHttp, normalizeServerUrl } from "./url";

export interface AddServerProps {
  /** Called with the saved entry (password stripped) after a successful save. */
  onAdded?: (server: ServerEntry) => void;
  /** Existing entry to edit; when set the form saves via update_server. */
  server?: ServerEntry;
}

type ProbeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; version?: string; latencyMs?: number }
  | { kind: "failure"; message: string };

const inputClass =
  "mt-1 w-full rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-sm text-fg-primary " +
  "placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function AddServer(props: AddServerProps) {
  // The wizard is mounted per entry (keyed in ServerHome), so reading the
  // initial values once is intentional; a blank password field keeps the
  // stored password on save.
  // eslint-disable-next-line solid/reactivity -- one-time prefill of edit mode
  const [name, setName] = createSignal(props.server?.name ?? "");
  // eslint-disable-next-line solid/reactivity -- one-time prefill of edit mode
  const [url, setUrl] = createSignal(props.server?.url ?? "");
  // eslint-disable-next-line solid/reactivity -- one-time prefill of edit mode
  const [username, setUsername] = createSignal(props.server?.username ?? "");
  const [password, setPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);
  const [probe, setProbe] = createSignal<ProbeState>({ kind: "idle" });
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const normalizedUrl = () => normalizeServerUrl(url());
  const urlValid = () => normalizedUrl() !== null;
  const nameValid = () => name().trim().length > 0;
  const canSave = () => nameValid() && urlValid() && !saving();
  const canProbe = () => urlValid() && probe().kind !== "loading";
  const remotePlainHttp = () => {
    const normalized = normalizedUrl();
    return normalized !== null && isRemotePlainHttp(normalized);
  };
  // The stored password is never prefilled; a blank field keeps it on save
  // and uses it for probes while editing.
  const storedPassword = () => props.server?.password;
  const auth = () => {
    const user = username().trim();
    const pass = password() || storedPassword();
    if (!user && !pass) return undefined;
    return { username: user || undefined, password: pass || undefined };
  };

  async function onTestConnection() {
    const normalized = normalizedUrl();
    if (!normalized || !canProbe()) return;
    setProbe({ kind: "loading" });
    try {
      const health = await probeServer(normalized, auth());
      if (health.healthy) {
        setProbe({ kind: "success", version: health.version, latencyMs: health.latencyMs });
      } else {
        setProbe({
          kind: "failure",
          message: "Could not connect. Check the URL and credentials.",
        });
      }
    } catch (err) {
      setProbe({ kind: "failure", message: ApiError.fromUnknown(err).message });
    }
  }

  async function onSave(event: SubmitEvent) {
    event.preventDefault();
    const normalized = normalizedUrl();
    if (!normalized || !canSave()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = {
        name: name().trim(),
        url: normalized,
        username: username().trim() || undefined,
        password: password() || storedPassword(),
      };
      const server = props.server
        ? await updateServer(props.server.id, input)
        : await addServer(input);
      // The saved entry is shared onward without the password.
      const publicEntry: ServerEntry = {
        id: server.id,
        name: server.name,
        url: server.url,
        username: server.username,
        createdAt: server.createdAt,
        lastConnectedAt: server.lastConnectedAt,
      };
      props.onAdded?.(publicEntry);
      if (!props.server) {
        setName("");
        setUrl("");
        setUsername("");
        setPassword("");
        setShowPassword(false);
        setProbe({ kind: "idle" });
      }
    } catch (err) {
      setSaveError(ApiError.fromUnknown(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="rounded-md border border-bg-sunken bg-bg-elevated p-6" data-testid="add-server">
      <h2 class="text-lg font-semibold">{props.server ? "Edit server" : "Add server"}</h2>
      <p class="mt-1 text-sm text-fg-secondary">
        {props.server ? (
          "Update the connection details. Leave the password blank to keep the stored one."
        ) : (
          <>
            Connect to an OpenCode server, e.g. <span class="font-code">localhost:14096</span>.
          </>
        )}
      </p>

      <form class="mt-6 space-y-4" onSubmit={onSave}>
        <label class="block">
          <span class="text-sm font-medium text-fg-secondary">Name</span>
          <input
            data-testid="name-input"
            class={inputClass}
            type="text"
            placeholder="My server"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <label class="block">
          <span class="text-sm font-medium text-fg-secondary">URL</span>
          <input
            data-testid="url-input"
            class={inputClass}
            type="text"
            inputmode="url"
            placeholder="http://localhost:14096"
            value={url()}
            onInput={(event) => setUrl(event.currentTarget.value)}
          />
          <Show when={remotePlainHttp()}>
            <div
              class="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
              data-testid="plain-http-warning"
            >
              Connecting over plain HTTP on a remote host. Credentials will travel unencrypted.
            </div>
          </Show>
        </label>

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="text-sm font-medium text-fg-secondary">Username (optional)</span>
            <input
              data-testid="username-input"
              class={inputClass}
              type="text"
              autocomplete="username"
              placeholder="admin"
              value={username()}
              onInput={(event) => setUsername(event.currentTarget.value)}
            />
          </label>

          <label class="block">
            <span class="text-sm font-medium text-fg-secondary">Password (optional)</span>
            <span class="relative block">
              <input
                data-testid="password-input"
                class={inputClass}
                type={showPassword() ? "text" : "password"}
                autocomplete="current-password"
                placeholder="••••••••"
                value={password()}
                onInput={(event) => setPassword(event.currentTarget.value)}
              />
              <button
                data-testid="password-toggle"
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-faint hover:text-fg-secondary"
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword() ? "Hide" : "Show"}
              </button>
            </span>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3 pt-1">
          <button
            data-testid="test-connection"
            type="button"
            class={`rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!canProbe()}
            onClick={onTestConnection}
          >
            Test connection
          </button>
          <button
            data-testid="save-server"
            type="submit"
            class={`rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!canSave()}
          >
            {saving() ? "Saving…" : props.server ? "Save changes" : "Save server"}
          </button>
        </div>

        <div class="min-h-5 text-sm">
          <Show when={probe().kind === "loading"}>
            <p class="text-fg-secondary" data-testid="probe-loading">
              Testing connection…
            </p>
          </Show>
          <Show when={probe().kind === "success"}>
            <p class="text-success" data-testid="probe-success">
              {probeSuccessText(probe())}
            </p>
          </Show>
          <Show when={probe().kind === "failure"}>
            <p class="text-danger" data-testid="probe-failure">
              {probeFailureText(probe())}
            </p>
          </Show>
          <Show when={saveError()}>
            <p class="text-danger" data-testid="save-error">
              {saveError()}
            </p>
          </Show>
        </div>
      </form>
    </div>
  );
}

function probeSuccessText(probe: ProbeState): string {
  if (probe.kind !== "success") return "";
  const parts: string[] = [];
  if (probe.version) parts.push(`version ${probe.version}`);
  if (probe.latencyMs !== undefined) parts.push(`${probe.latencyMs} ms`);
  return parts.length > 0 ? parts.join(" · ") : "Connected";
}

function probeFailureText(probe: ProbeState): string {
  return probe.kind === "failure" ? probe.message : "";
}

export default AddServer;
