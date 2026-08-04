// Generates tests/fixtures/session.messages.long.json: 120 single-text-part
// messages (msg_l1..msg_l120, chronological) so client pagination tests can
// walk three 50-message pages against a fixed, committed fixture.
//
// Run: node tests/mock-server/gen-long-fixture.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COUNT = 120;
const SESSION_ID = "ses_abc123";
const T0 = 1750000000000;

const messages = [];
for (let i = 1; i <= COUNT; i++) {
  const id = `msg_l${i}`;
  messages.push({
    info: {
      id,
      sessionID: SESSION_ID,
      role: i % 2 === 1 ? "user" : "assistant",
      time: { created: T0 + i * 60_000 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    },
    parts: [
      {
        id: `prt_l${i}`,
        sessionID: SESSION_ID,
        messageID: id,
        type: "text",
        text: `Long fixture message ${i}`,
      },
    ],
  });
}

const out = resolve(ROOT, "tests/fixtures/session.messages.long.json");
writeFileSync(out, `${JSON.stringify(messages, null, 2)}\n`);
console.log(`wrote ${messages.length} messages to ${out}`);
