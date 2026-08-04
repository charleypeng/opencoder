// Mobile Terminal page (TASK-M7-09): the terminal tab. Renders the shared
// TerminalPanel in its mobile variant — multi-tab terminals plus the aux
// key strip (Esc/Tab/Ctrl/arrows/|) and the double-tap font zoom. The root
// carries the `landscape-terminal` class so the view goes fullscreen
// (100dvh, chrome-hidden) in landscape orientation (TASK-M7-04 mechanism).

import type { Component } from "solid-js";
import TerminalPanel from "../../features/terminal/TerminalPanel.js";
import { PageHeader } from "./PageHeader.js";
import type { MobilePageProps } from "./pages.js";

export const TerminalPage: Component<MobilePageProps> = (props) => (
  <div class="landscape-terminal flex h-full flex-col" data-testid="mobile-page-terminal-root">
    <PageHeader title="Terminal" onBack={props.onExit} backLabel="Servers" />
    <div class="min-h-0 flex-1">
      <TerminalPanel serverId={props.serverId} variant="mobile" />
    </div>
  </div>
);
