// Snapshot marker (TASK-M3-02 / M6-04): renders a SnapshotPart as a subtle
// chip with a camera icon, the "Snapshot" label and the short snapshot id.
// M6 wires the revert action here: when an `onRevert` callback is provided
// the chip becomes a revert trigger for the MESSAGE that carries the
// snapshot (the callback reports the containing message id); without it the
// chip stays inert and explains itself via its tooltip.

import { createMemo } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";

export type SnapshotPartData = Extract<Part, { type: "snapshot" }>;

export interface SnapshotPartProps {
  part: SnapshotPartData;
  /** Reverts the session to the message carrying this snapshot (wired by
   *  M6-04, the caller shows the confirm dialog); while absent the chip
   *  stays inert. */
  onRevert?: (messageID: string) => void;
}

const SnapshotPart: Component<SnapshotPartProps> = (props) => {
  const t = useT();
  const shortId = createMemo(() => props.part.snapshot.slice(0, 12));
  // The callback never changes for a mounted chip, so a memo is cheap and
  // keeps the template fully tracked.
  const wired = createMemo(() => props.onRevert !== undefined);

  return (
    <span
      data-testid="snapshot-part"
      role={wired() ? "button" : undefined}
      tabIndex={wired() ? 0 : undefined}
      class={
        "my-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-bg-sunken " +
        "bg-bg-sunken/60 px-2 py-0.5 text-xs text-fg-secondary" +
        (wired()
          ? " cursor-pointer outline-none hover:border-accent hover:text-accent focus-visible:border-accent"
          : "")
      }
      title={wired() ? t("messages:revertSnapshotHint") : t("messages:revertSnapshotM6")}
      onClick={() => {
        if (wired()) props.onRevert?.(props.part.messageID);
      }}
      onKeyDown={(event) => {
        if (wired() && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          props.onRevert?.(props.part.messageID);
        }
      }}
    >
      <svg
        aria-hidden
        class="h-3.5 w-3.5 shrink-0 text-fg-faint"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="2" y="4.5" width="12" height="9" rx="1.5" />
        <circle cx="8" cy="9" r="2.5" />
        <path d="M5.5 4.5 6.8 2.8h2.4l1.3 1.7" />
      </svg>
      <span class="font-medium">{t("messages:snapshot")}</span>
      <span data-testid="snapshot-id" class="font-code text-[10px] text-fg-faint">
        {shortId()}
      </span>
    </span>
  );
};

export default SnapshotPart;
