// Default-workspace onboarding dialog (feat(default-workspace)): shown the
// first time a server is entered when it has no workspace history yet. It
// reuses the directory picker with onboarding copy — picking a folder
// persists it as the server's default workspace (and enters it via the
// picker's add flow); skipping defers the choice (the user can set it later
// in Settings → Servers, or pick a directory from the sidebar directly).

import type { Component } from "solid-js";
import { useT } from "../../i18n/index.js";
import { setDefaultWorkspace } from "../servers/defaultWorkspace.js";
import { addWorkspace } from "./workspaces.js";
import DirectoryPickerDialog from "./DirectoryPickerDialog.js";

export interface DefaultWorkspaceDialogProps {
  /** The server being onboarded. */
  serverId: string;
  /** Closes the dialog (skip / cancel / Esc / backdrop). */
  onClose: () => void;
}

const DefaultWorkspaceDialog: Component<DefaultWorkspaceDialogProps> = (props) => {
  const t = useT();
  return (
    <DirectoryPickerDialog
      serverId={props.serverId}
      title={t("sessions:defaultWorkspaceTitle")}
      hint={t("sessions:defaultWorkspaceHint")}
      showSkip
      onAdded={(directory) => {
        // The picked folder is both the server's default workspace AND its
        // first entry in the explicit workspace list, so it shows up in the
        // tree right away (and survives restarts).
        setDefaultWorkspace(props.serverId, directory);
        addWorkspace(props.serverId, directory);
        props.onClose();
      }}
      onClose={() => props.onClose()}
    />
  );
};

export default DefaultWorkspaceDialog;
