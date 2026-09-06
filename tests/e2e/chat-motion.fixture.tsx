import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import ProcessFold from "../../src/features/messages/parts/ProcessFold";
import UserMessageContent from "../../src/features/messages/UserMessageContent";
import type { Part } from "../../src/stores/messages";
import "../../src/styles/tokens.css";
import "../../src/styles/index.css";

const parts: Part[] = [
  {
    type: "reasoning",
    id: "thought",
    messageID: "reply",
    sessionID: "demo",
    text: "Checking the workspace before making changes.\n".repeat(6),
    time: { start: 1, end: 2 },
  },
  {
    type: "tool",
    id: "tool",
    callID: "call",
    messageID: "reply",
    sessionID: "demo",
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "git status --short" },
      output: " M README.md\n".repeat(8),
      title: "git status",
      metadata: {},
      time: { start: 2, end: 4 },
    },
  },
];

function Preview() {
  const [active, setActive] = createSignal(true);
  return (
    <main style={{ "max-width": "760px", margin: "40px auto", padding: "16px" }}>
      <div class="rounded-2xl bg-accent-soft p-4">
        <UserMessageContent messageKey="preview:user">
          <p class="whitespace-pre-wrap">
            {"Skill instructions: inspect the code, preserve the original text and verify the result.\n".repeat(
              25,
            )}
            END OF ORIGINAL MESSAGE
          </p>
        </UserMessageContent>
      </div>
      <ProcessFold
        parts={parts}
        active={active()}
        startedAt={Date.now() - 12000}
        completedAt={Date.now()}
        runKey="preview:run"
      />
      <p>The answer stays readable while thoughts and tool output are available on demand.</p>
      <button data-testid="finish-run" onClick={() => setActive(false)}>
        Finish
      </button>
    </main>
  );
}

render(() => <Preview />, document.getElementById("root")!);
