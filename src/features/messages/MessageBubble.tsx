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
import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { messages } from "../../stores/messages.js";
import type { Part } from "../../stores/messages.js";
import { useT } from "../../i18n/index.js";
import MessageActions from "./MessageActions.js";
import CompactionPart from "./parts/CompactionPart.js";
import FilePart from "./parts/FilePart.js";
import PatchPart from "./parts/PatchPart.js";
import RetryPart from "./parts/RetryPart.js";
import SnapshotPart from "./parts/SnapshotPart.js";
import TextPart from "./parts/TextPart.js";
import ProcessFold from "./parts/ProcessFold.js";

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
  /** Session-level streaming flag (busy + recent deltas) used by the trace
   *  caller for compatibility; streaming status never forces disclosure. */
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
  | { type: "retry" }
  | { type: "compaction" }
>;

function isRenderable(part: Part | undefined): part is RenderablePart {
  if (part === undefined) return false;
  // Todos/tasks already live in the TaskPanel/TodoPanel — never render them
  // as chat message parts (that would duplicate the panel). Case-insensitive
  // so "task", "todowrite", "TodoWrite", etc. all collapse to the panel.
  if (part.type === "tool" && /^(todo|task)/i.test(part.tool ?? "")) return false;
  return (
    part.type === "text" ||
    part.type === "reasoning" ||
    part.type === "tool" ||
    part.type === "file" ||
    part.type === "patch" ||
    part.type === "snapshot" ||
    part.type === "retry" ||
    part.type === "compaction"
  );
}

// Process parts and attention events are observable steps of one agent run.
// The chat refactor collects them into one Activity Trace rendered BELOW the
// answer instead of interspersed between text parts, so the final answer reads
// first and the process is one optional disclosure.
// Todo/task tools still go to the TaskPanel and never reach the fold.
type ProcessPart = Extract<
  Part,
  { type: "reasoning" } | { type: "tool" } | { type: "compaction" } | { type: "retry" }
>;

function isProcessPart(part: Part | undefined): part is ProcessPart {
  if (part === undefined) return false;
  if (part.type === "tool" && /^(todo|task)/i.test(part.tool ?? "")) return false;
  return (
    part.type === "reasoning" ||
    part.type === "tool" ||
    part.type === "compaction" ||
    part.type === "retry"
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
  onRevert?: (messageID: string) => void;
  onOpenChild?: (sessionId: string) => void;
}) {
  // Part components receive at least `part`; extra props (onRevert etc.)
  // are ignored by components that do not use them. The common props shape
  // keeps Dynamic's type check satisfied for every part component.
  type PartProps = {
    part?: Part;
    streaming?: boolean;
    onRevert?: (messageID: string) => void;
    onOpenChild?: (sessionId: string) => void;
  };
  const PartComponent = createMemo<Component<PartProps> | null>(() => {
    switch (props.part?.type) {
      case "text":
        return TextPart as Component<PartProps>;
      case "file":
        return FilePart as Component<PartProps>;
      case "patch":
        return PatchPart as Component<PartProps>;
      case "snapshot":
        return SnapshotPart as Component<PartProps>;
      case "retry":
        return RetryPart as Component<PartProps>;
      case "compaction":
        return CompactionPart as Component<PartProps>;
      default:
        // Unsupported part types render nothing until their milestones land.
        return null;
    }
  });
  return (
    <Show when={PartComponent() !== null} fallback={null}>
      <Dynamic
        component={PartComponent() as Component<PartProps>}
        part={props.part}
        streaming={props.streaming}
        onRevert={props.onRevert}
        onOpenChild={
          props.onOpenChild === undefined
            ? undefined
            : () => props.onOpenChild?.(props.part?.sessionID ?? "")
        }
      />
    </Show>
  );
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

  // Chat refactor: the message's parts are split into the ANSWER parts
  // (text/file/patch/snapshot/retry/compaction, rendered in original order)
  // and the PROCESS parts (reasoning/tool calls/attention events, collected into one trace
  // below the answer). Each memo reads the store per part id, so streamed
  // deltas keep the fine-grained updates (only the touched part re-renders).
  const contentPartIds = createMemo(() =>
    props.partIds.filter((id) => {
      const part = messages[props.serverId]?.[props.sessionId]?.parts[id];
      return part !== undefined && isRenderable(part) && !isProcessPart(part);
    }),
  );
  const processPartIds = createMemo(() =>
    props.partIds.filter((id) =>
      isProcessPart(messages[props.serverId]?.[props.sessionId]?.parts[id]),
    ),
  );
  const processParts = createMemo(() =>
    processPartIds().map((id) => messages[props.serverId]?.[props.sessionId]?.parts[id]),
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
          <For each={contentPartIds()}>
            {(partId) => {
              const part = () => messages[props.serverId]?.[props.sessionId]?.parts[partId];
              return (
                <PartView
                  part={part()}
                  streaming={props.typing === true && lastTextPartId() === partId}
                  onRevert={props.onRevert}
                  onOpenChild={props.onOpenChild}
                />
              );
            }}
          </For>
          {/* Chat refactor: all process parts (reasoning + tool calls) render
              below the answer in one collapsed fold with a status summary. */}
          <Show when={processParts().length > 0}>
            <ProcessFold
              parts={processParts()}
              runKey={props.messageID}
              streaming={props.streaming === true}
            />
          </Show>
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
