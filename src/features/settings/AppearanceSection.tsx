// Appearance settings section (TASK-M9-03): the theme mode (dark / light /
// system), the accent color (six presets + a custom hex picker) and, on
// mobile, the true-black OLED background. The top controls edit the GLOBAL
// memory; the Server override sub-section pins this server's own mode
// (resolution: server override ?? global, re-applied by App when entering
// the server — src/stores/theme.ts). Every change applies instantly through
// documentElement dataset.theme + the --accent CSS variable; the signals
// only drive the selected states.

import { For, Show, createSignal } from "solid-js";
import type { Component } from "solid-js";
import { useT } from "../../i18n/index.js";
import { platform } from "../../platform/index.js";
import {
  ACCENT_PRESETS,
  THEME_MODES,
  accentColor,
  clearServerThemeOverride,
  setAccent,
  setOled,
  setServerThemeOverride,
  setThemeMode,
  themeMode,
  oled,
  accent,
  themeServerOverrides,
} from "../../stores/theme.js";
import type { ThemeMode } from "../../stores/theme.js";
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  setUiScale,
  uiScale,
} from "../../stores/uiScale.js";

function ToggleSwitch(props: {
  testId: string;
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={props.testId}
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      onClick={() => props.onToggle(!props.checked)}
      class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors ${
        props.checked ? "bg-accent" : "bg-bg-sunken"
      }`}
    >
      <span
        class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
          props.checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** i18n key of a theme mode label (settings:themeDark / themeLight /
 *  themeSystem). */
function modeKey(mode: ThemeMode): string {
  return `settings:theme${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
}

/** i18n key of an accent preset label (settings:accentIndigo, …). */
function presetKey(id: string): string {
  return `settings:accent${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

export interface AppearanceSectionProps {
  /** The server whose settings are shown; its override is edited here. */
  serverId: string;
}

const AppearanceSection: Component<AppearanceSectionProps> = (props) => {
  const t = useT();
  const override = (): ThemeMode | undefined => themeServerOverrides()[props.serverId];
  const customHex = (): string => accentColor(accent());
  /** In-progress hex draft; undefined means the field shows the committed
   *  accent. Kept separate so intermediate typing (e.g. "#12") never
   *  reverts mid-entry — validation happens on commit (blur) instead. */
  const [hexDraft, setHexDraft] = createSignal<string | undefined>(undefined);

  return (
    <div data-testid="appearance-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:appearance")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:appearanceHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="border-b border-bg-sunken py-3">
          <p class="text-xs font-medium">{t("settings:theme")}</p>
          <div class="mt-2 flex gap-2">
            <For each={THEME_MODES}>
              {(mode) => (
                <button
                  type="button"
                  data-testid={`theme-${mode}`}
                  aria-pressed={themeMode() === mode ? "true" : "false"}
                  onClick={() => setThemeMode(mode)}
                  class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
                    themeMode() === mode
                      ? "border-accent bg-accent-soft text-fg-primary"
                      : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {t(modeKey(mode))}
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={platform.kind === "mobile"}>
          <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
            <div class="min-w-0">
              <p class="text-xs font-medium">{t("settings:oledBlack")}</p>
              <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:oledBlackHint")}</p>
            </div>
            <ToggleSwitch
              testId="theme-oled"
              label={t("settings:oledBlack")}
              checked={oled()}
              onToggle={(next) => setOled(next)}
            />
          </div>
        </Show>
        <div class="border-b border-bg-sunken py-3">
          <p class="text-xs font-medium">{t("settings:accent")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:accentHint")}</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <For each={ACCENT_PRESETS}>
              {(preset) => (
                <button
                  type="button"
                  data-testid={`accent-preset-${preset.id}`}
                  aria-pressed={accent() === preset.id ? "true" : "false"}
                  aria-label={t(presetKey(preset.id))}
                  title={t(presetKey(preset.id))}
                  onClick={() => setAccent(preset.id)}
                  class={`h-7 w-7 rounded-full outline-none transition-shadow ${
                    accent() === preset.id
                      ? "ring-2 ring-fg-primary ring-offset-2 ring-offset-bg-base"
                      : "hover:ring-2 hover:ring-fg-faint hover:ring-offset-2 hover:ring-offset-bg-base"
                  }`}
                  style={{ background: preset.color }}
                />
              )}
            </For>
            <div
              data-testid="accent-custom"
              data-custom={/^#/.test(accent()) ? "true" : "false"}
              class="flex items-center gap-1.5"
            >
              <input
                type="color"
                value={customHex()}
                onInput={(event) => setAccent(event.currentTarget.value)}
                aria-label={t("settings:accentCustom")}
                title={t("settings:accentCustom")}
                class="h-7 w-9 cursor-pointer rounded-md border border-bg-sunken bg-transparent p-0.5"
              />
              <input
                type="text"
                data-testid="accent-custom-input"
                value={hexDraft() ?? customHex()}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setHexDraft(value);
                  // Live-apply values the store accepts (HEX_RE 3–8);
                  // everything else stays in the draft until the commit.
                  if (/^#[0-9a-f]{3,8}$/i.test(value)) setAccent(value);
                }}
                onBlur={() => {
                  const draft = hexDraft();
                  if (draft !== undefined && /^#[0-9a-f]{3,8}$/i.test(draft)) setAccent(draft);
                  setHexDraft(undefined);
                }}
                aria-label={t("settings:accentCustom")}
                spellcheck={false}
                class="w-20 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1 font-code text-xs text-fg-secondary outline-none focus:border-accent focus:text-fg-primary"
              />
            </div>
          </div>
        </div>
        <Show when={platform.kind === "desktop"}>
          <div class="border-b border-bg-sunken py-3">
            <p class="text-xs font-medium">{t("settings:uiScale")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:uiScaleHint")}</p>
            <div class="mt-2 flex items-center gap-3">
              <input
                type="range"
                data-testid="ui-scale-slider"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={UI_SCALE_STEP}
                value={uiScale()}
                aria-label={t("settings:uiScale")}
                onInput={(event) => setUiScale(Number(event.currentTarget.value))}
                class="w-48 cursor-pointer accent-accent"
              />
              <span
                data-testid="ui-scale-value"
                class="shrink-0 font-code text-xs text-fg-secondary"
              >
                {Math.round(uiScale() * 100)}%
              </span>
            </div>
          </div>
        </Show>
        <div class="py-3" data-testid="theme-server-override">
          <p class="text-xs font-medium">{t("settings:serverTheme")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:serverThemeHint")}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="theme-server-follow"
              aria-pressed={override() === undefined ? "true" : "false"}
              onClick={() => clearServerThemeOverride(props.serverId)}
              class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
                override() === undefined
                  ? "border-accent bg-accent-soft text-fg-primary"
                  : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {t("settings:followGlobal")}
            </button>
            <For each={THEME_MODES}>
              {(mode) => (
                <button
                  type="button"
                  data-testid={`theme-server-${mode}`}
                  aria-pressed={override() === mode ? "true" : "false"}
                  onClick={() => setServerThemeOverride(props.serverId, mode)}
                  class={`rounded-md border px-3 py-1.5 text-xs outline-none transition-colors ${
                    override() === mode
                      ? "border-accent bg-accent-soft text-fg-primary"
                      : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {t(modeKey(mode))}
                </button>
              )}
            </For>
            <Show when={override() !== undefined}>
              <button
                type="button"
                data-testid="theme-server-clear"
                onClick={() => clearServerThemeOverride(props.serverId)}
                class="rounded-md px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
              >
                {t("settings:clearOverride")}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppearanceSection;
