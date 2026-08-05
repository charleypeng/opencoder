// Settings center (TASK-M9-04): the sectioned settings view. The section
// registry (./sections.js) drives everything — the sidebar nav (desktop)
// or the horizontal chip row (mobile), the settings search (filters the
// nav by translated title / hint / keywords) and the active-section
// rendering; section state is component-local (URL-less). Desktop mounts
// this view through the gear button with its own Back header; the mobile
// settings tab renders the same page in the mobile variant (chips, no
// Back header — a tab root has nothing to pop back to).

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { SECTIONS } from "./sections.js";
import type { SectionId } from "./sections.js";
import { useT } from "../../i18n/index.js";

export interface SettingsPageProps {
  /** The server whose settings are shown. */
  serverId: string;
  /** Desktop header back button; the mobile tab root passes none. */
  onBack?: () => void;
  /** Desktop: sidebar nav + Back header. Mobile: horizontal chip nav. */
  variant?: "desktop" | "mobile";
}

const SettingsPage: Component<SettingsPageProps> = (props) => {
  const t = useT();
  const [section, setSection] = createSignal<SectionId>(SECTIONS[0].id);
  const [query, setQuery] = createSignal("");

  /** Nav entries matching the search query (translated title, hint,
   *  keywords); the full list when the query is empty. */
  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (q === "") return SECTIONS;
    return SECTIONS.filter((def) => {
      if (t(def.titleKey).toLowerCase().includes(q)) return true;
      if (t(def.hintKey).toLowerCase().includes(q)) return true;
      return def.keywords.some((word) => word.toLowerCase().includes(q));
    });
  });

  const active = createMemo(() => SECTIONS.find((def) => def.id === section()) ?? SECTIONS[0]);

  /** Renders the active section component (local-const dynamic component). */
  function renderActive(): JSX.Element {
    const Cmp = active().component;
    return <Cmp serverId={props.serverId} />;
  }

  const selectedClass = (id: SectionId): string =>
    section() === id ? "bg-accent-soft text-fg-primary" : "text-fg-secondary hover:text-fg-primary";

  function navButton(def: (typeof SECTIONS)[number], chip: boolean): JSX.Element {
    // TASK-M9-08: `aria-selected` requires a selection role (tab/option/row
    // — the nav is a plain button list, not a tablist), so the active
    // section uses `aria-current` instead (axe aria-allowed-attr).
    return (
      <button
        type="button"
        data-testid={`settings-section-${def.id}`}
        data-active={section() === def.id ? "true" : "false"}
        aria-current={section() === def.id ? "true" : undefined}
        class={`outline-none transition-colors ${selectedClass(def.id)} ${
          chip
            ? "flex shrink-0 items-center gap-1.5 rounded-full border border-bg-sunken px-3 py-1.5 text-xs"
            : "flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs"
        }`}
        onClick={() => setSection(def.id)}
      >
        <span class="shrink-0">{def.icon}</span>
        {t(def.titleKey)}
      </button>
    );
  }

  const navList = (chip: boolean): JSX.Element => (
    <Show
      when={matches().length > 0}
      fallback={
        <p data-testid="settings-search-empty" class="px-3 py-1.5 text-xs text-fg-faint">
          {t("settings:searchNoMatches", { query: query() })}
        </p>
      }
    >
      <For each={matches()}>{(def) => navButton(def, chip)}</For>
    </Show>
  );

  return (
    <div
      data-testid="settings-page"
      data-variant={props.variant ?? "desktop"}
      class="flex h-full min-h-0 flex-col"
    >
      <Show when={(props.variant ?? "desktop") === "desktop"}>
        <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-4 py-2">
          <button
            type="button"
            data-testid="settings-back"
            class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
            onClick={() => props.onBack?.()}
          >
            ← {t("common:back")}
          </button>
          <h2 class="shrink-0 text-sm font-semibold">{t("settings:settings")}</h2>
        </header>
      </Show>
      <div class="shrink-0 border-b border-bg-sunken px-4 py-2">
        <input
          data-testid="settings-search"
          type="text"
          value={query()}
          placeholder={t("settings:searchPlaceholder")}
          aria-label={t("settings:searchPlaceholder")}
          spellcheck={false}
          onInput={(event) => setQuery(event.currentTarget.value)}
          class="w-full max-w-xs rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint"
        />
      </div>
      <Show
        when={(props.variant ?? "desktop") === "desktop"}
        fallback={
          <div class="flex min-h-0 flex-1 flex-col">
            <nav
              data-testid="settings-sections"
              data-kind="chips"
              aria-label={t("settings:sections")}
              class="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2"
            >
              {navList(true)}
            </nav>
            <div class="flex min-h-0 flex-1 flex-col">{renderActive()}</div>
          </div>
        }
      >
        <div class="flex min-h-0 flex-1">
          <nav
            data-testid="settings-sections"
            data-kind="sidebar"
            aria-label={t("settings:sections")}
            class="flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-r border-bg-sunken p-2"
          >
            {navList(false)}
          </nav>
          <div class="flex min-h-0 flex-1 flex-col">{renderActive()}</div>
        </div>
      </Show>
    </div>
  );
};

export default SettingsPage;
