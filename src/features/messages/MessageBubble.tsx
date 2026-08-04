// Message bubble (TASK-M2-09): renders ONE message as the bubble column
// (user right-aligned / assistant left-aligned) with a timestamp. Extracted
// from MessageList so each message subscribes to the store INDIVIDUALLY:
// the bubble reads only its own info (`infos[id]`) and its own parts
// (`parts[id]` per part row), so a delta landing on another message re-runs
// nothing here, and a delta on one of this message's parts re-renders only
// that part row (Solid fine-grained). The previous design re-grouped the
// whole transcript on every part mutation and re-rendered every bubble.
//
// `typing` marks this message as the one currently streaming; the caret is
// rendered at the end of its LAST text part (see TextPart streaming prop).

import { createMemo, For, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { messages } from "../../stores/messages.js";
import type { Part } from "../../stores/messages.js";
import AgentPart from "./parts/AgentPart.js";
import CompactionPart from "./parts/CompactionPart.js";
import FilePart from "./parts/FilePart.js";
import PatchPart from "./parts/PatchPart.js";
import RetryPart from "./parts/RetryPart.js";
import ReasoningPart from "./parts/ReasoningPart.js";
import SnapshotPart from "./parts/SnapshotPart.js";
import { StepFinishPart, StepStartPart } from "./parts/StepPart.js";
import SubtaskPart from "./parts/SubtaskPart.js";
import TextPart from "./parts/TextPart.js";
import ToolPart from "./parts/ToolPart.js";

export interface MessageBubbleProps {
  /** The server whose session is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
  /** Message id; info and parts are read from the store by id. */
  messageID: string;
  /** Ordered part ids of this message (from the store's messageParts). */
  partIds: string[];
  /** Shows the breathing caret on the message's last text part. */
  typing?: boolean;
}

type RenderablePart = Extract<
  Part,
  | { type: "text" }
  | { type: "reasoning" }
  | { type: "tool" }
  | { type: "file" }
  | { type: "patch" }
  | { type: "snapshot" }
  | { type: "step-start" }
  | { type: "step-finish" }
  | { type: "subtask" }
  | { type: "agent" }
  | { type: "retry" }
  | { type: "compaction" }
>;

function isRenderable(part: Part | undefined): part is RenderablePart {
  return (
    part !== undefined &&
    (part.type === "text" ||
      part.type === "reasoning" ||
      part.type === "tool" ||
      part.type === "file" ||
      part.type === "patch" ||
      part.type === "snapshot" ||
      part.type === "step-start" ||
      part.type === "step-finish" ||
      part.type === "subtask" ||
      part.type === "agent" ||
      part.type === "retry" ||
      part.type === "compaction")
  );
}

/** Local hh:mm timestamp for a message's created time. */
function formatMessageTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function PartView(props: { part: Part | undefined; streaming?: boolean }) {
  // Memoized dispatch so the type switch stays inside a tracked scope; a
  // part's type is immutable for a given identity.
  const view = createMemo<JSX.Element>(() => {
    switch (props.part?.type) {
      case "text":
        return <TextPart part={props.part} streaming={props.streaming} />;
      case "reasoning":
        return <ReasoningPart part={props.part} />;
      case "tool":
        return <ToolPart part={props.part} />;
      case "file":
        return <FilePart part={props.part} />;
      case "patch":
        return <PatchPart part={props.part} />;
      case "snapshot":
        return <SnapshotPart part={props.part} />;
      case "step-start":
        return <StepStartPart part={props.part} />;
      case "step-finish":
        return <StepFinishPart part={props.part} />;
      case "subtask":
        return <SubtaskPart part={props.part} />;
      case "agent":
        return <AgentPart part={props.part} />;
      case "retry":
        return <RetryPart part={props.part} />;
      case "compaction":
        return <CompactionPart part={props.part} />;
      default:
        // Unsupported part types render nothing until their milestones land.
        return null;
    }
  });
  return <>{view()}</>;
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  // Streamed messages may arrive (as part stubs) before their message.updated
  // info; assistant is the safe fallback for an in-flight generation.
  const info = () => messages[props.serverId]?.[props.sessionId]?.infos[props.messageID];
  const role = () => info()?.role ?? "assistant";
  const user = () => role() === "user";
  const created = () => info()?.time.created;

  // At least one supported part renders; otherwise the bubble is skipped.
  const hasRenderable = createMemo(() =>
    props.partIds.some((id) =>
      isRenderable(messages[props.serverId]?.[props.sessionId]?.parts[id]),
    ),
  );

  // The streaming part is the LAST text part of the message (the caret only
  // mounts there).
  const lastTextPartId = createMemo(() => {
    const ids = props.partIds;
    for (let i = ids.length - 1; i >= 0; i--) {
      const part = messages[props.serverId]?.[props.sessionId]?.parts[ids[i]];
      if (part?.type === "text") return ids[i];
    }
    return undefined;
  });

  return (
    <Show when={hasRenderable()}>
      <div
        data-testid={`message-${props.messageID}`}
        data-role={role()}
        class={`flex flex-col gap-1 ${user() ? "items-end" : "items-start"}`}
      >
        <div
          class={`max-w-[78%] rounded-lg px-3 py-2 ${
            user()
              ? "rounded-br-sm bg-accent-soft"
              : "rounded-bl-sm border border-bg-sunken bg-bg-elevated"
          }`}
        >
          <For each={props.partIds}>
            {(partId) => {
              const part = () => messages[props.serverId]?.[props.sessionId]?.parts[partId];
              return (
                <PartView
                  part={part()}
                  streaming={props.typing === true && lastTextPartId() === partId}
                />
              );
            }}
          </For>
        </div>
        <Show when={created() !== undefined}>
          <span data-testid="message-time" class="px-1 text-xs text-fg-faint">
            {formatMessageTime(created() as number)}
          </span>
        </Show>
      </div>
    </Show>
  );
};

export default MessageBubble;
