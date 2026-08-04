// Mobile file viewer page (TASK-M7-09): pushed from the Files tab when a
// file row is tapped (the tree already opened the tab in the viewer store,
// so this page just renders the active tab). `fullscreen` turns on the
// mobile affordances in FileViewer — the double-tap code zoom and pan-able
// touch scrolling.

import { Show } from "solid-js";
import type { Component } from "solid-js";
import FileViewer from "../../features/files/FileViewer.js";
import { tabNameOf } from "../../stores/viewer.js";
import { back } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import type { MobilePageProps } from "./pages.js";

export const FileViewPage: Component<MobilePageProps> = (props) => {
  const path = () => props.route.params?.path ?? null;
  return (
    <div class="flex h-full flex-col" data-testid="mobile-page-file-view">
      <PageHeader
        title={path() !== null ? tabNameOf(path() as string) : "File"}
        onBack={() => back()}
      />
      <Show when={path() !== null}>
        <div class="min-h-0 flex-1">
          <FileViewer serverId={props.serverId} fullscreen />
        </div>
      </Show>
    </div>
  );
};
