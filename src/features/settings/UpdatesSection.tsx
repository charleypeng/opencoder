// Updates settings section (TASK-M8-09): the app version readout, a manual
// "Check for updates" button and the install flow (download progress +
// relaunch) once an update is available. The updater endpoint points at the
// GitHub releases latest.json (tauri.conf.json) — until the M10-04 release
// pipeline publishes signed artifacts the check either resolves "up to
// date" (no release published) or fails with a readable error. Outside
// Tauri (web builds / L2) the facade no-ops: the check reports up to date
// and the version readout shows "—". A once-a-day startup auto-check also
// runs (DesktopShell mount); the install flow stays here.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { useT } from "../../i18n/index.js";
import {
  checkForUpdates,
  getAppVersion,
  installAndRelaunch,
  type Update,
  type UpdateProgress,
} from "../../services/updates.js";

type CheckState = "idle" | "checking" | "up-to-date" | "update-available" | "error";

/** Rounds the download progress fraction to a percent for display. */
export function percentOf(progress: UpdateProgress): number | undefined {
  if (progress.fraction === undefined) return undefined;
  return Math.min(100, Math.max(0, Math.round(progress.fraction * 100)));
}

const UpdatesSection: Component = () => {
  const t = useT();
  const [version, setVersion] = createSignal<string | null>(null);
  const [checkState, setCheckState] = createSignal<CheckState>("idle");
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [checkError, setCheckError] = createSignal<string | null>(null);
  const [installing, setInstalling] = createSignal(false);
  const [progress, setProgress] = createSignal<UpdateProgress | null>(null);
  const [installError, setInstallError] = createSignal<string | null>(null);

  // One-shot version readout; null outside Tauri renders "—".
  void getAppVersion().then(setVersion);

  async function handleCheck() {
    setCheckError(null);
    setInstallError(null);
    setCheckState("checking");
    try {
      const found = await checkForUpdates();
      if (found === null) {
        setCheckState("up-to-date");
        setUpdate(null);
      } else {
        setCheckState("update-available");
        setUpdate(found);
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err));
      setCheckState("error");
    }
  }

  async function handleInstall() {
    const target = update();
    if (target === null) return;
    setInstalling(true);
    setInstallError(null);
    setProgress(null);
    try {
      await installAndRelaunch(target, (next) => setProgress(next));
      // installAndRelaunch relaunches the app; reaching this line means the
      // relaunch was refused (e.g. a dev build) — the UI stays as-is.
      setInstalling(false);
    } catch (err) {
      setInstalling(false);
      setInstallError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div data-testid="updates-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:updates")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:updatesHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:applicationVersion")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:updatesDailyHint")}</p>
          </div>
          <span data-testid="updates-version" class="shrink-0 font-code text-xs text-fg-secondary">
            {version() ?? "—"}
          </span>
        </div>
        <div class="flex flex-col gap-2 py-3">
          <button
            type="button"
            data-testid="updates-check"
            disabled={checkState() === "checking" || installing()}
            class="w-fit rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-primary outline-none transition-colors hover:border-fg-faint disabled:cursor-default disabled:opacity-60"
            onClick={() => void handleCheck()}
          >
            {checkState() === "checking" ? t("updates:checking") : t("updates:checkForUpdates")}
          </button>
          <Show when={checkState() === "checking"}>
            <span
              data-testid="updates-checking"
              class="flex items-center gap-2 text-xs text-fg-secondary"
            >
              <span
                class="h-3 w-3 animate-spin rounded-full border-2 border-bg-sunken border-t-accent"
                aria-hidden="true"
              />
              {t("updates:checking")}
            </span>
          </Show>
          <Show when={checkState() === "up-to-date"}>
            <p data-testid="updates-result" class="text-xs text-fg-secondary">
              You're up to date.
            </p>
          </Show>
          <Show when={checkState() === "update-available" && update() !== null}>
            <div
              data-testid="updates-available"
              class="flex flex-col gap-2 rounded-md border border-accent bg-accent-soft p-3"
            >
              <p class="text-xs text-fg-primary">Update available: v{update()?.version}</p>
              <Show when={installing()}>
                <div class="h-1.5 w-full overflow-hidden rounded-full bg-bg-sunken">
                  <div
                    data-testid="updates-progress"
                    class="h-full rounded-full bg-accent transition-[width]"
                    style={{
                      width: `${progress() === null ? 0 : (percentOf(progress() as UpdateProgress) ?? 0)}%`,
                    }}
                  />
                </div>
                <p data-testid="updates-progress-label" class="text-xs text-fg-secondary">
                  {progress() === null
                    ? "Downloading…"
                    : percentOf(progress() as UpdateProgress) === undefined
                      ? `Downloading… (${progress()?.downloaded} bytes)`
                      : `Downloading… ${percentOf(progress() as UpdateProgress)}%`}
                </p>
              </Show>
              <button
                type="button"
                data-testid="updates-install"
                disabled={installing()}
                class="w-fit rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-fg-primary outline-none transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
                onClick={() => void handleInstall()}
              >
                {installing() ? "Installing…" : "Install & restart"}
              </button>
              <Show when={installError() !== null}>
                <p data-testid="updates-install-error" class="text-xs text-danger">
                  Couldn't install the update: {installError()}
                </p>
              </Show>
            </div>
          </Show>
          <Show when={checkState() === "error"}>
            <p data-testid="updates-error" class="text-xs text-danger">
              Couldn't check for updates: {checkError()}
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default UpdatesSection;
