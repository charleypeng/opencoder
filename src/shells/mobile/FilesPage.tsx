// Mobile Files page (TASK-M7-09): the file browser tab. Renders the mobile
// FileTree variant (single-level navigation + breadcrumb back bar); tapping
// a file opens it in the viewer store and pushes the FileView page, which
// renders the shared FileViewer in its mobile fullscreen form (reusing the
// per-server viewer store as-is — the viewer page shows the active tab).

import type { Component } from "solid-js";
import FileTree from "../../features/files/FileTree.js";
import { openTab } from "../../stores/viewer.js";
import { push } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import type { MobilePageProps } from "./pages.js";
import { useT } from "../../i18n/index.js";

export const FilesPage: Component<MobilePageProps> = (props) => {
  const t = useT();
  return (
    <div class="flex h-full flex-col" data-testid="mobile-page-files-root">
      <PageHeader title={t("mobile:files")} onBack={props.onExit} backLabel={t("mobile:servers")} />
      <div class="min-h-0 flex-1">
        <FileTree
          serverId={props.serverId}
          variant="mobile"
          onOpenFile={(path) => {
            openTab(props.serverId, path);
            push({ page: "file-view", params: { path } });
          }}
        />
      </div>
    </div>
  );
};
