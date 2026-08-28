// General settings section (TASK-M9-04): app identity (name / version),
// the ACTIVE server's version and health status, the MIT license and the
// project links, and the Reset settings action that clears every oc-*
// localStorage preference and reloads the app. The reset is two-step
// (click again to confirm) so a stray click cannot wipe the preferences.
// The About section folded in here per docs/ui-audit-2026-08 §7 — both
// showed the same identity/version/links, so two nav entries read as
// duplication. Outside Tauri the version readouts show an em dash (the
// facade resolves null).

import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getAppVersion } from "../../services/updates.js";
import { connections } from "../../stores/connection.js";
import { useT } from "../../i18n/index.js";

const GITHUB_URL = "https://github.com/charleypeng/opencoder";
const DOCS_URL = `${GITHUB_URL}/blob/main/docs/PLAN.md`;
const AGENTS_URL = `${GITHUB_URL}/blob/main/AGENTS.md`;
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;

export interface GeneralSectionProps {
  /** The server whose settings are shown; its health snapshot is read. */
  serverId: string;
}

type HealthKind = "ok" | "slow" | "down" | "unknown";

const dotClass: Record<HealthKind, string> = {
  ok: "bg-success",
  slow: "bg-warning",
  down: "bg-danger",
  unknown: "bg-fg-faint",
};

const statusLabelKey: Record<HealthKind, string> = {
  ok: "servers:statusOnline",
  slow: "servers:statusSlow",
  down: "servers:statusOffline",
  unknown: "servers:statusUnknown",
};

const GeneralSection: Component<GeneralSectionProps> = (props) => {
  const t = useT();
  const [version, setVersion] = createSignal<string | null>(null);
  const [armed, setArmed] = createSignal(false);

  try {
    void getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  } catch {
    // Outside Tauri the facade already resolves null; a broken facade
    // must not crash the section.
  }

  const health = () => connections[props.serverId];
  const kind = (): HealthKind => health()?.status ?? "unknown";

  /** Best-effort external link open (the opener plugin no-ops in web). */
  async function openLink(url: string): Promise<void> {
    try {
      await openUrl(url);
    } catch {
      // Best-effort: an unavailable browser must not break the section.
    }
  }

  function handleReset() {
    if (!armed()) {
      setArmed(true);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith("oc-")) localStorage.removeItem(key);
    }
    window.location.reload();
  }

  const linkClass =
    "rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs " +
    "text-fg-secondary outline-none transition-colors hover:border-fg-faint hover:text-fg-primary";

  return (
    <div data-testid="general-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:general")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:generalHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">opencoder</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:generalTagline")}</p>
          </div>
          <span data-testid="general-version" class="shrink-0 font-code text-xs text-fg-secondary">
            {version() ?? "—"}
          </span>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-xs font-medium">
              <span
                data-testid="general-server-status"
                data-status={kind()}
                class={`h-2 w-2 shrink-0 rounded-full ${dotClass[kind()]}`}
              />
              {t("settings:serverVersion")}
            </p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t(statusLabelKey[kind()])}</p>
          </div>
          <span
            data-testid="general-server-version"
            class="shrink-0 font-code text-xs text-fg-secondary"
          >
            {health()?.version ?? "—"}
          </span>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:license")}</p>
          </div>
          <button
            type="button"
            data-testid="general-license"
            class={linkClass}
            onClick={() => void openLink(LICENSE_URL)}
          >
            {t("settings:licenseValue")}
          </button>
        </div>
        <div class="border-b border-bg-sunken py-3">
          <p class="text-xs font-medium">{t("settings:links")}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="general-docs"
              class={linkClass}
              onClick={() => void openLink(DOCS_URL)}
            >
              {t("settings:documentation")}
            </button>
            <button
              type="button"
              data-testid="general-agents"
              class={linkClass}
              onClick={() => void openLink(AGENTS_URL)}
            >
              AGENTS.md
            </button>
            <button
              type="button"
              data-testid="general-github"
              class={linkClass}
              onClick={() => void openLink(GITHUB_URL)}
            >
              {t("settings:github")}
            </button>
          </div>
        </div>
        <div class="py-3">
          <p class="text-xs font-medium">{t("settings:resetSettings")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:resetSettingsHint")}</p>
          <button
            type="button"
            data-testid="general-reset"
            class="mt-2 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:border-danger/50 hover:text-danger"
            onClick={handleReset}
          >
            {armed() ? t("settings:resetConfirm") : t("settings:resetSettings")}
          </button>
        </div>
        <p data-testid="general-copyright" class="pb-3 text-xs text-fg-faint">
          {t("settings:copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
};

export default GeneralSection;
