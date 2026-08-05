// Settings section registry (TASK-M9-04): the ordered list of settings
// sections drives the SettingsPage navigation (sidebar on desktop, chip
// row on mobile), the settings search (matched against the translated
// title, the hint and English keywords) and the active-section rendering.
// Components receive the active server id; sections that do not need it
// simply ignore the prop.

import type { Component, JSX } from "solid-js";
import ProviderKeys from "./providers/ProviderKeys.js";
import ShortcutsSection from "./ShortcutsSection.js";
import DesktopSection from "./DesktopSection.js";
import NotificationsSection from "./NotificationsSection.js";
import UpdatesSection from "./UpdatesSection.js";
import LanguageSection from "./LanguageSection.js";
import AppearanceSection from "./AppearanceSection.js";
import GeneralSection from "./GeneralSection.js";
import AboutSection from "./AboutSection.js";
import ServersSection from "./ServersSection.js";

export type SectionId =
  | "general"
  | "appearance"
  | "language"
  | "providers"
  | "servers"
  | "shortcuts"
  | "desktop"
  | "notifications"
  | "updates"
  | "about";

export interface SettingsSectionDef {
  id: SectionId;
  /** i18n key of the nav label (e.g. settings:general). */
  titleKey: string;
  /** i18n key of the one-line hint, used by the search and the section header. */
  hintKey: string;
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
  servers: <Icon path="M2 2h20v8H2zM2 14h20v8H2zM6 6h.01M6 18h.01" />,
  shortcuts: (
    <Icon path="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  ),
  desktop: <Icon path="M2 3h20v14H2zM8 21h8M12 17v4" />,
  notifications: (
    <Icon path="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.5 0" />
  ),
  updates: <Icon path="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  about: <Icon path="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />,
};

/** The ordered section list; SettingsPage defaults to the first entry. */
export const SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: "general",
    titleKey: "settings:general",
    hintKey: "settings:generalHint",
    icon: ICONS.general,
    keywords: ["app", "identity", "reset", "links", "version"],
    component: GeneralSection,
  },
  {
    id: "appearance",
    titleKey: "settings:appearance",
    hintKey: "settings:appearanceHint",
    icon: ICONS.appearance,
    keywords: ["theme", "accent", "color", "dark", "light", "oled"],
    component: AppearanceSection,
  },
  {
    id: "language",
    titleKey: "settings:language",
    hintKey: "settings:languageHint",
    icon: ICONS.language,
    keywords: ["locale", "lang", "中文", "english"],
    component: LanguageSection,
  },
  {
    id: "providers",
    titleKey: "settings:providers",
    hintKey: "settings:providersHint",
    icon: ICONS.providers,
    keywords: ["api", "key", "oauth", "model"],
    component: ProviderKeys,
  },
  {
    id: "servers",
    titleKey: "servers:servers",
    hintKey: "settings:serversHint",
    icon: ICONS.servers,
    keywords: ["connection", "notification", "theme", "override"],
    component: ServersSection,
  },
  {
    id: "shortcuts",
    titleKey: "settings:shortcuts",
    hintKey: "settings:shortcutHint",
    icon: ICONS.shortcuts,
    keywords: ["keyboard", "keys", "combo", "hotkey"],
    component: ShortcutsSection,
  },
  {
    id: "desktop",
    titleKey: "settings:desktop",
    hintKey: "settings:desktopHint",
    icon: ICONS.desktop,
    keywords: ["tray", "pet", "summon", "global"],
    component: DesktopSection,
  },
  {
    id: "notifications",
    titleKey: "settings:notifications",
    hintKey: "settings:notificationsHint",
    icon: ICONS.notifications,
    keywords: ["alert", "bell", "dnd", "do not disturb"],
    component: NotificationsSection,
  },
  {
    id: "updates",
    titleKey: "settings:updates",
    hintKey: "settings:updatesHint",
    icon: ICONS.updates,
    keywords: ["version", "auto-update", "changelog"],
    component: UpdatesSection,
  },
  {
    id: "about",
    titleKey: "settings:about",
    hintKey: "settings:aboutHint",
    icon: ICONS.about,
    keywords: ["version", "license", "github", "docs", "documentation"],
    component: AboutSection,
  },
];
