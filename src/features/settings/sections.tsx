// Settings section registry (TASK-M9-04): the ordered list of settings
// sections drives the SettingsPage navigation (sidebar on desktop, chip
// row on mobile), the settings search (matched against the translated
// title, the hint and English keywords — keywords include the section's
// CONTROL labels, so e.g. "accent" or "default model" find their section)
// and the active-section rendering. Components receive the active server
// id; sections that do not need it simply ignore the prop. The About and
// Models sections are folded away (docs/ui-audit-2026-08 §7): About's
// content merged into General, Models' default-model row moved into
// Config.

import type { Component, JSX } from "solid-js";
import ProviderKeys from "./providers/ProviderKeys.js";
import McpSection from "./mcp/McpSection.js";
import ShortcutsSection from "./ShortcutsSection.js";
import DesktopSection from "./DesktopSection.js";
import PetSection from "./PetSection.js";
import NotificationsSection from "./NotificationsSection.js";
import UpdatesSection from "./UpdatesSection.js";
import LanguageSection from "./LanguageSection.js";
import AppearanceSection from "./AppearanceSection.js";
import GeneralSection from "./GeneralSection.js";
import ServersSection from "./ServersSection.js";
import ConfigSection from "./config/ConfigSection.js";
import DiagnosticsSection from "./diagnostics/DiagnosticsSection.js";

export type SectionId =
  | "general"
  | "appearance"
  | "language"
  | "providers"
  | "mcp"
  | "servers"
  | "shortcuts"
  | "desktop"
  | "pet"
  | "notifications"
  | "updates"
  | "config"
  | "diagnostics";

/** Nav group ids (docs/ui-audit-2026-08 §7): the flat 15-entry list is
 *  hard to scan, so the desktop sidebar renders grouped headers. */
export type SectionGroupId = "app" | "connections" | "system" | "advanced";

export interface SectionGroupDef {
  id: SectionGroupId;
  /** i18n key of the group header label. */
  titleKey: string;
}

/** The ordered nav groups; sections without a match are hidden on search. */
export const SECTION_GROUPS: readonly SectionGroupDef[] = [
  { id: "app", titleKey: "settings:groupApp" },
  { id: "connections", titleKey: "settings:groupConnections" },
  { id: "system", titleKey: "settings:groupSystem" },
  { id: "advanced", titleKey: "settings:groupAdvanced" },
];

export interface SettingsSectionDef {
  id: SectionId;
  /** i18n key of the nav label (e.g. settings:general). */
  titleKey: string;
  /** i18n key of the one-line hint, used by the search and the section header. */
  hintKey: string;
  /** Nav group the section belongs to (desktop sidebar headers). */
  group: SectionGroupId;
  icon: JSX.Element;
  /** Extra English search terms beyond title/hint. */
  keywords: readonly string[];
  component: Component<{ serverId: string }>;
}

/** 16px stroke icon for one nav entry. */
function Icon(props: { path: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
      aria-hidden="true"
    >
      <path d={props.path} />
    </svg>
  );
}

const ICONS: Record<SectionId, JSX.Element> = {
  general: <Icon path="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  appearance: <Icon path="M12 2.7 17.7 8.4a8 8 0 1 1-11.3 0z" />,
  language: (
    <Icon path="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  ),
  providers: (
    <Icon path="m21 2-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  ),
  mcp: <Icon path="M10 2v6L4 16v4h6v2l6-6V10l4-4V2h-6v4l-4 4V2z" />,
  servers: <Icon path="M2 2h20v8H2zM2 14h20v8H2zM6 6h.01M6 18h.01" />,
  shortcuts: (
    <Icon path="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  ),
  desktop: <Icon path="M2 3h20v14H2zM8 21h8M12 17v4" />,
  pet: (
    <Icon path="M4 11.5C4 7.9 7.6 5 12 5s8 2.9 8 6.5V16a3 3 0 0 1-3 3h-1.5l-1.2-2h-4.6l-1.2 2H7a3 3 0 0 1-3-3zM8 11h.01M16 11h.01M9 14c1.7 1.2 4.3 1.2 6 0" />
  ),
  notifications: (
    <Icon path="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.5 0" />
  ),
  updates: <Icon path="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  config: (
    <Icon path="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5c0 1.1-.9 2-2 2h-1" />
  ),
  diagnostics: (
    <Icon path="M12 3a7 7 0 0 0-7 7c0 2 .9 3.5 1.5 4.5L5 21h14l-1.5-6.5C18.1 13.5 19 12 19 10a7 7 0 0 0-7-7zM8.5 10h7" />
  ),
};

/** The ordered section list; SettingsPage defaults to the first entry. */
export const SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: "general",
    titleKey: "settings:general",
    hintKey: "settings:generalHint",
    group: "app",
    icon: ICONS.general,
    keywords: [
      "app",
      "identity",
      "reset",
      "links",
      "version",
      "about",
      "license",
      "copyright",
      "server version",
    ],
    component: GeneralSection,
  },
  {
    id: "appearance",
    titleKey: "settings:appearance",
    hintKey: "settings:appearanceHint",
    group: "app",
    icon: ICONS.appearance,
    keywords: [
      "theme",
      "accent",
      "color",
      "dark",
      "light",
      "oled",
      "scale",
      "size",
      "zoom",
      "server override",
    ],
    component: AppearanceSection,
  },
  {
    id: "language",
    titleKey: "settings:language",
    hintKey: "settings:languageHint",
    group: "app",
    icon: ICONS.language,
    keywords: ["locale", "lang", "中文", "english"],
    component: LanguageSection,
  },
  {
    id: "providers",
    titleKey: "settings:providers",
    hintKey: "settings:providersHint",
    group: "connections",
    icon: ICONS.providers,
    keywords: ["api", "key", "oauth", "model"],
    component: ProviderKeys,
  },
  {
    id: "mcp",
    titleKey: "settings:mcp",
    hintKey: "settings:mcpHint",
    group: "connections",
    icon: ICONS.mcp,
    keywords: ["mcp", "model context protocol", "tools", "server", "connect", "oauth"],
    component: McpSection,
  },
  {
    id: "servers",
    titleKey: "servers:servers",
    hintKey: "settings:serversHint",
    group: "connections",
    icon: ICONS.servers,
    keywords: ["connection", "notification", "theme", "override"],
    component: ServersSection,
  },
  {
    id: "shortcuts",
    titleKey: "settings:shortcuts",
    hintKey: "settings:shortcutHint",
    group: "system",
    icon: ICONS.shortcuts,
    keywords: ["keyboard", "keys", "combo", "hotkey"],
    component: ShortcutsSection,
  },
  {
    id: "desktop",
    titleKey: "settings:desktop",
    hintKey: "settings:desktopHint",
    group: "system",
    icon: ICONS.desktop,
    keywords: ["tray", "summon", "global"],
    component: DesktopSection,
  },
  {
    id: "pet",
    titleKey: "settings:pet",
    hintKey: "settings:petHint",
    group: "system",
    icon: ICONS.pet,
    keywords: ["pet", "companion", "click-through", "clickthrough", "mascot"],
    component: PetSection,
  },
  {
    id: "notifications",
    titleKey: "settings:notifications",
    hintKey: "settings:notificationsHint",
    group: "system",
    icon: ICONS.notifications,
    keywords: ["alert", "bell", "dnd", "do not disturb"],
    component: NotificationsSection,
  },
  {
    id: "updates",
    titleKey: "settings:updates",
    hintKey: "settings:updatesHint",
    group: "system",
    icon: ICONS.updates,
    keywords: ["version", "auto-update", "changelog"],
    component: UpdatesSection,
  },
  {
    id: "config",
    titleKey: "settings:config",
    hintKey: "settings:configHint",
    group: "advanced",
    icon: ICONS.config,
    keywords: [
      "opencode.json",
      "json",
      "global",
      "dispose",
      "merge",
      "default model",
      "default agent",
      "share",
      "autoupdate",
      "auto title",
    ],
    component: ConfigSection,
  },
  {
    id: "diagnostics",
    titleKey: "settings:diagnostics",
    hintKey: "settings:diagnosticsHint",
    group: "advanced",
    icon: ICONS.diagnostics,
    keywords: ["log", "console", "lsp", "formatter", "permission", "saved", "server", "upgrade"],
    component: DiagnosticsSection,
  },
];
