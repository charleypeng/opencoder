// Language settings section (TASK-M9-01): the app language switcher —
// English / 简体中文 — wired to the i18n singleton (`setLang` persists the
// override to localStorage `oc-lang`; without an override the app follows
// the system locale). This is the first consumer of the i18n
// infrastructure; TASK-M9-02 migrates the remaining hardcoded strings.

import type { Component } from "solid-js";
import { language, setLang, useT } from "../../i18n/index.js";

const LanguageSection: Component = () => {
  const t = useT();

  return (
    <div data-testid="language-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:language")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:languageHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex flex-col gap-2">
          <button
            type="button"
            data-testid="language-en"
            aria-pressed={language() === "en" ? "true" : "false"}
            onClick={() => setLang("en")}
            class={`rounded-md border px-3 py-2 text-left text-xs outline-none transition-colors ${
              language() === "en"
                ? "border-accent bg-accent-soft text-fg-primary"
                : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
            }`}
          >
            English
          </button>
          <button
            type="button"
            data-testid="language-zh"
            aria-pressed={language() === "zh-CN" ? "true" : "false"}
            onClick={() => setLang("zh-CN")}
            class={`rounded-md border px-3 py-2 text-left text-xs outline-none transition-colors ${
              language() === "zh-CN"
                ? "border-accent bg-accent-soft text-fg-primary"
                : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
            }`}
          >
            简体中文
          </button>
        </div>
      </div>
    </div>
  );
};

export default LanguageSection;
