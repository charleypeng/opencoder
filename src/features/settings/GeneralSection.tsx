// General settings section (TASK-M9-04): app identity (name / version),
// links to the project documentation and the repository, and the Reset
// settings action that clears every oc-* localStorage preference and
// reloads the app. The reset is two-step (click again to confirm) so a
// stray click cannot wipe the preferences.

import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getAppVersion } from "../../services/updates.js";
import { useT } from "../../i18n/index.js";

const GITHUB_URL = "https://github.com/charleypeng/opencoder";
const DOCS_URL = `${GITHUB_URL}/blob/main/docs/PLAN.md`;
const AGENTS_URL = `${GITHUB_URL}/blob/main/AGENTS.md`;

const GeneralSection: Component = () => {
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
        <div class="border-b border-bg-sunken py-3">
          <p class="text-xs font-medium">opencoder</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:generalTagline")}</p>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:applicationVersion")}</p>
          </div>
          <span data-testid="general-version" class="shrink-0 font-code text-xs text-fg-secondary">
            {version() ?? "—"}
          </span>
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
      </div>
    </div>
  );
};

export default GeneralSection;
