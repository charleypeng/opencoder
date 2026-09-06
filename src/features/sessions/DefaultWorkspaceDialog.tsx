// Default-workspace onboarding dialog (feat(default-workspace)): shown the
// first time a server is entered when it has no workspace history yet. It
// deliberately shows an app-owned prompt before mounting the native picker,
// so no OS permission dialog appears until the user explicitly chooses one.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { useT } from "../../i18n/index.js";
import { setDefaultWorkspace } from "../servers/defaultWorkspace.js";
import { addWorkspace } from "./workspaces.js";
import DirectoryPickerDialog from "./DirectoryPickerDialog.js";

export interface DefaultWorkspaceDialogProps {
  /** The server being onboarded. */
  serverId: string;
  /** Closes the dialog (skip / Esc / backdrop, or after a chosen folder). */
  onClose: () => void;
}

const DefaultWorkspaceDialog: Component<DefaultWorkspaceDialogProps> = (props) => {
  const t = useT();
  const [pickerOpen, setPickerOpen] = createSignal(false);

  return (
    <Show
      when={pickerOpen()}
      fallback={
        <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
          <Dialog.Portal>
            <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
            <Dialog.Content
              data-testid="default-workspace-onboarding"
              class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-5"
            >
              <Dialog.Title class="text-md font-semibold">
                {t("sessions:defaultWorkspaceTitle")}
              </Dialog.Title>
              <Dialog.Description class="text-sm text-fg-secondary">
                {t("sessions:defaultWorkspaceHint")}
              </Dialog.Description>
              <div class="flex items-center justify-end gap-2">
                <button
                  type="button"
                  data-testid="default-workspace-skip"
                  onClick={props.onClose}
                  class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
                >
                  {t("sessions:skip")}
                </button>
                <button
                  type="button"
                  data-testid="default-workspace-choose"
                  onClick={() => setPickerOpen(true)}
                  class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white outline-none hover:opacity-90"
                >
                  {t("sessions:defaultWorkspaceChoose")}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      }
    >
      <DirectoryPickerDialog
        serverId={props.serverId}
        onAdded={(directory) => {
          // The picked folder is both the server's default workspace AND its
          // first entry in the explicit workspace list, so it shows up in the
          // tree right away (and survives restarts).
          setDefaultWorkspace(props.serverId, directory);
          addWorkspace(props.serverId, directory);
        }}
        onClose={props.onClose}
      />
    </Show>
  );
};

export default DefaultWorkspaceDialog;
