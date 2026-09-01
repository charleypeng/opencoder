// i18n singleton (TASK-M9-01): i18next with English + Simplified Chinese
// resources, system-locale detection with a persisted manual override
// (localStorage `oc-lang`), and a Solid-reactive `useT` hook so components
// re-render on language switches. TASK-M9-02 migrates the app's hardcoded
// strings onto these namespaces.

import i18next from "i18next";
import type { ResourceLanguage, TFunction } from "i18next";
import { createSignal } from "solid-js";
import en from "./en.json";
import zhCN from "./zh-CN.json";
import { setTrayLanguage } from "../services/tray.js";

export type AppLanguage = "en" | "zh-CN";

/** localStorage key for the manual language override. */
export const LANG_STORAGE_KEY = "oc-lang";

const SUPPORTED_LANGS: readonly AppLanguage[] = ["en", "zh-CN"];

/** Reads the persisted override; malformed or absent values yield null. */
function readOverride(): AppLanguage | null {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return SUPPORTED_LANGS.includes(stored as AppLanguage) ? (stored as AppLanguage) : null;
  } catch {
    return null;
  }
}

/** Resolves the effective language: a manual override wins, otherwise the
 *  system locale (any `zh*` navigator language maps to zh-CN, everything
 *  else to en). */
export function detectLanguage(): AppLanguage {
  const override = readOverride();
  if (override !== null) return override;
  const system = navigator.language ?? "";
  return system.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

const [language, setLanguage] = createSignal<AppLanguage>(detectLanguage());

void i18next.init({
  resources: { en: en as ResourceLanguage, "zh-CN": zhCN as ResourceLanguage },
  // eslint-disable-next-line solid/reactivity -- one-time initial value at module load
  lng: language(),
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/** Keeps native surfaces (currently the system tray) aligned with the
 *  language selected in the webview, including the persisted choice that is
 *  applied during initial module evaluation. */
function syncNativeLanguage(lng: AppLanguage): void {
  void setTrayLanguage(lng).catch(() => {
    // Browser previews and older native builds may not expose this command.
  });
}

syncNativeLanguage(detectLanguage());

/** The current language signal (read-only; switch via `setLang`). */
export { language };

/** Switches the app language: updates the reactive signal (components
 *  re-render immediately) and persists the override so the next launch
 *  starts in the same language. */
export function setLang(lng: AppLanguage): void {
  setLanguage(lng);
  void i18next.changeLanguage(lng);
  syncNativeLanguage(lng);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lng);
  } catch {
    // Storage unavailable (private mode): the session keeps working.
  }
}

/** Solid-reactive translation hook: returns an i18next t function bound to
 *  the CURRENT language signal. Reading `language()` inside the returned
 *  closure tracks the signal, so JSX using `t("ns:key")` re-renders on
 *  language switches. */
export function useT(): TFunction {
  // eslint-disable-next-line solid/reactivity -- call-time read: the returned t() is invoked inside the caller's computation, tracking the signal there
  return ((key: unknown, options?: unknown): unknown => {
    const lng = language();
    const opts =
      typeof options === "string"
        ? { lng, defaultValue: options }
        : { lng, ...(options as object) };
    return i18next.t(key as string, opts);
  }) as TFunction;
}
