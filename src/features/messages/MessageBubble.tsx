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
import { useT } from "../../i18n/index.js";
import MessageActions from "./MessageActions.js";
import AgentPart from "./parts/AgentPart.js";
import CompactionPart from "./parts/CompactionPart.js";
import FilePart from "./parts/FilePart.js";
import PatchPart from "./parts/PatchPart.js";
import RetryPart from "./parts/RetryPart.js";
import ReasoningPart from "./parts/ReasoningPart.js";
import SnapshotPart from "./parts/SnapshotPart.js";
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
  /** Session-level streaming flag (busy + recent deltas): the reasoning
   *  fold auto-expands while the agent is generating and auto-collapses
   *  when generation ends, so the thinking process is visible live. */
  streaming?: boolean;
  /** Opens the M4 diff view for this message (wired by M4-07); while
   *  absent the message menu's "View diff" item stays disabled. */
  onViewDiff?: (messageID: string) => void;
  /** Forks the session from this message (wired by M6-03); while absent
   *  the message menu's "Fork from here" item stays disabled. */
  onFork?: (messageID: string) => void;
  /** Reverts the session to this message (wired by M6-04); while absent
   *  the message menu's "Revert to here" item and the snapshot chip stay
   *  disabled/inert. */
  onRevert?: (messageID: string) => void;
  /** Opens the child session of the session containing a subtask part
   *  (wired by M6-07); while absent the part's button stays hidden. */
  onOpenChild?: (sessionId: string) => void;
  /** Mobile presentation (TASK-M7-06): long-press action menu. */
  mobile?: boolean;
}

type RenderablePart = Extract<
  Part,
  | { type: "text" }
  | { type: "reasoning" }
  | { type: "tool" }
  | { type: "file" }
  | { type: "patch" }
  | { type: "snapshot" }
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

function PartView(props: {
  part: Part | undefined;
  /** Breathing-caret streaming flag for the last text part. */
  streaming?: boolean;
  /** Session-level streaming flag: the reasoning fold auto-expands while
   *  the agent is generating (see ReasoningPart). */
  sessionStreaming?: boolean;
  onRevert?: (messageID: string) => void;
  onOpenChild?: (sessionId: string) => void;
}) {
  // Memoized dispatch so the type switch stays inside a tracked scope; a
  // part's type is immutable for a given identity.
  //
  // The memo's EQUALITY compares the rendered component type (the JSX
  // element's `.type`), NOT the element identity: `message.part.updated`
  // replaces the part object wholesale while streaming, and without the
  // custom equals the memo would return a fresh element on every
  // replacement, re-creating the part component and resetting its local
  // state (the reasoning fold collapsed mid-stream). Same-type updates
  // keep the previous element (same component instance, props flow through
  // reactively); a genuine type change (delta stub -> real part) still
  // swaps the component.
  const view = createMemo<JSX.Element>(
    () => {
      switch (props.part?.type) {
        case "text":
          return <TextPart part={props.part} streaming={props.streaming} />;
        case "reasoning":
          return <ReasoningPart part={props.part} streaming={props.sessionStreaming} />;
        case "tool":
          return <ToolPart part={props.part} />;
        case "file":
          return <FilePart part={props.part} />;
        case "patch":
          return <PatchPart part={props.part} />;
        case "snapshot":
          // M6-04: the snapshot chip reverts its containing message.
          return <SnapshotPart part={props.part} onRevert={props.onRevert} />;
        case "subtask":
          // M6-07: the subtask part's session id is the session that owns the
          // part; the wired handler resolves the child session from it.
          return (
            <SubtaskPart
              part={props.part}
              onOpenChild={
                props.onOpenChild === undefined
                  ? undefined
                  : () => props.onOpenChild?.(props.part?.sessionID ?? "")
              }
            />
          );
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
    },
    undefined,
    {
      // JSX elements carry the component function as `.type`; comparing the
      // rendered component type keeps the memo value stable across part
      // object replacements (see the comment above).
      equals: (a, b) =>
        a === b ||
        ((a as { type?: unknown } | null)?.type ?? null) ===
          ((b as { type?: unknown } | null)?.type ?? null),
    },
  );
  return <>{view()}</>;
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const t = useT();
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
      <MessageActions
        serverId={props.serverId}
        sessionId={props.sessionId}
        messageID={props.messageID}
        partIds={props.partIds}
        mobile={props.mobile}
        onViewDiff={props.onViewDiff}
        onFork={props.onFork}
        onRevert={props.onRevert}
      >
        {/* IA-05: persistent AI label on assistant messages (IBM-Carbon
          AI label requirement) — small accent-tinted badge, content-first
          chrome that stays out of the way of the message body. */}
        <Show when={!user()}>
          <span class="ai-label" data-testid="ai-label">
            {t("messages:aiLabel")}
          </span>
        </Show>
        {/* Assistant messages render chrome-free directly on the transcript
          (content-first, docs/ui-design.md §1): only the user side keeps a
          bubble. Part rows carry their own subtle chrome, so wrapping the
          assistant message in a card produced noisy box-in-box nesting. */}
        <div
          class={
            user()
              ? "max-w-[78%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2"
              : "w-full max-w-3xl"
          }
        >
          <For each={props.partIds}>
            {(partId) => {
              const part = () => messages[props.serverId]?.[props.sessionId]?.parts[partId];
              return (
                <PartView
                  part={part()}
                  streaming={props.typing === true && lastTextPartId() === partId}
                  sessionStreaming={props.streaming === true}
                  onRevert={props.onRevert}
                  onOpenChild={props.onOpenChild}
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
      </MessageActions>
    </Show>
  );
};

export default MessageBubble;
