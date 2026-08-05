// Mobile page registry (TASK-M7-03): maps navigation page keys (navigation.ts
// Route.page) to components. Pages receive the server id, the shell exit
// callback and their route (params). Sessions/Chat/Files/FileView/Terminal
// are real; the Diff push is a placeholder until a later task composes it.
// TASK-M9-04 wires the Settings tab to the real settings center
// (SettingsPage mobile variant: chip nav instead of the sidebar).

import type { Component } from "solid-js";
import { lazy } from "solid-js";
import { back } from "./navigation.js";
import { useT } from "../../i18n/index.js";
import type { Route } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import { ChatPage } from "./ChatPage.js";
import { SessionsPage } from "./SessionsPage.js";
import { FilesPage } from "./FilesPage.js";
import { FileViewPage } from "./FileViewPage.js";
import SettingsPage from "../../features/settings/SettingsPage.js";

// TASK-M9-08: the terminal page (and with it the xterm.js bundle) loads
// lazily — only the terminal tab mounts it, so xterm stays out of the
// startup chunk (bundle-size budget, docs/performance.md).
const TerminalPage = lazy(() =>
  import("./TerminalPage.js").then((m) => ({ default: m.TerminalPage })),
);

export interface MobilePageProps {
  serverId: string;
  onExit: () => void;
  route: Route;
}

export type MobilePage = Component<MobilePageProps>;

/** Fallback for unknown page keys (defensive; a registry typo must not
 *  blank the shell). */
export const NotFoundPage: MobilePage = (props) => {
  const t = useT();
  return (
    <div class="flex h-full flex-col" data-testid="mobile-page-not-found">
      <PageHeader title={t("mobile:notFound")} onBack={() => back()} />
      <p class="p-4 text-sm text-fg-secondary">
        {t("mobile:unknownPage")}: {props.route.page}
      </p>
    </div>
  );
};

/** Thin placeholder for pages that land in later tasks. The optional root
 *  class lets a placeholder participate in M7-04 layouts early (the
 *  Terminal placeholder goes fullscreen in landscape). */
function placeholderPage(titleKey: string, rootClass = ""): MobilePage {
  return () => {
    const t = useT();
    const title = t(titleKey);
    return (
      <div
        class={`flex h-full flex-col ${rootClass}`}
        data-testid={`mobile-page-${title.toLowerCase()}-placeholder`}
      >
        <PageHeader title={title} onBack={() => back()} />
        <div class="flex flex-1 items-center justify-center p-4">
          <p class="text-sm text-fg-secondary">{t("mobile:placeholderHint", { title })}</p>
        </div>
      </div>
    );
  };
}

export const pageRegistry: Record<string, MobilePage> = {
  sessions: SessionsPage,
  chat: ChatPage,
  files: FilesPage,
  "file-view": FileViewPage,
  terminal: TerminalPage,
  settings: (props) => <SettingsPage serverId={props.serverId} variant="mobile" />,
  diff: placeholderPage("mobile:diff"),
};
