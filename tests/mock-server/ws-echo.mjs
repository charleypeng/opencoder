// Standalone WebSocket echo server for PTY channel contract tests
// (TASK-M6-01).
//
// The express mock cannot upgrade to WebSocket natively, so the PTY data
// channel is simulated here: every received frame (binary or text) is echoed
// back verbatim, mirroring how the Rust transport's read loop would push
// terminal output. The mock self-test spawns this server and drives a
// send/echo round trip; a real `opencode serve` verification is pending
// (docs/tasks/M6.md appendix).
//
// Usage: node tests/mock-server/ws-echo.mjs [--port 14097]

import { WebSocketServer } from "ws";

const portArg = process.argv.indexOf("--port");
const port = Number(portArg !== -1 ? process.argv[portArg + 1] : 14097);

const wss = new WebSocketServer({ port });

wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    // Echo verbatim: Buffer is passed through, so binary frames stay binary.
    socket.send(data);
  });
  socket.on("error", () => {});
});

console.log(`[ws-echo] listening on ws://localhost:${port}`);
