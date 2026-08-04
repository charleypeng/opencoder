// Mobile page registry (TASK-M7-03): maps navigation page keys (navigation.ts
// Route.page) to components. Pages receive the server id, the shell exit
// callback and their route (params). Only the Sessions root and the pushed
// Chat page are real today; Files/Terminal/Settings roots and the Diff
// push are placeholders until later M7/M9 tasks compose them.

import type { Component } from "solid-js";
import { back } from "./navigation.js";
import type { Route } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import { ChatPage } from "./ChatPage.js";
import { SessionsPage } from "./SessionsPage.js";

export interface MobilePageProps {
  serverId: string;
  onExit: () => void;
  route: Route;
}

export type MobilePage = Component<MobilePageProps>;

/** Fallback for unknown page keys (defensive; a registry typo must not
 *  blank the shell). */
export const NotFoundPage: MobilePage = (props) => (
  <div class="flex h-full flex-col" data-testid="mobile-page-not-found">
    <PageHeader title="Not found" onBack={() => back()} />
    <p class="p-4 text-sm text-fg-secondary">Unknown page: {props.route.page}</p>
  </div>
);

/** Thin placeholder for pages that land in later tasks. */
function placeholderPage(title: string): MobilePage {
  return () => (
    <div
      class="flex h-full flex-col"
      data-testid={`mobile-page-${title.toLowerCase()}-placeholder`}
    >
      <PageHeader title={title} onBack={() => back()} />
      <div class="flex flex-1 items-center justify-center p-4">
        <p class="text-sm text-fg-secondary">{title} — mobile page lands in a later M7 task</p>
      </div>
    </div>
  );
}

export const pageRegistry: Record<string, MobilePage> = {
  sessions: SessionsPage,
  chat: ChatPage,
  files: placeholderPage("Files"),
  terminal: placeholderPage("Terminal"),
  settings: placeholderPage("Settings"),
  diff: placeholderPage("Diff"),
};
