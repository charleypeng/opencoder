// Generates tests/mock-server/fixtures/session.messages.rich.json — a
// large, realistic chat transcript exercising every part type (text with
// code fences/tables/lists, reasoning, tool calls in all states, file,
// patch, snapshot, subtask, agent, retry, compaction) plus a
// Heartbeat-SSE-style long document (mirroring the real-world content the
// user reported overlapping in the transcript). Serves as the mock's
// "大量对话" fixture for visual/UX verification of the chat redesign.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/mock-server/fixtures/session.messages.rich.json",
);

const SESSION = "ses_rich_01";
const T0 = 1750000000000;
const DAY = 86400_000;
const MIN = 60_000;

let t = T0 - 3 * DAY; // conversation spans ~3 days
let msgN = 0;
let partN = 0;

function nextTime(deltaMin = 2) {
  t += deltaMin * MIN;
  return t;
}

function info(role, opts = {}) {
  return {
    id: `msg_rich_${String(++msgN).padStart(2, "0")}`,
    sessionID: SESSION,
    role,
    time: { created: nextTime(), completed: opts.done ? nextTime(0) : undefined },
    ...(opts.parentID ? { parentID: opts.parentID } : {}),
    ...(opts.agent ? { agent: opts.agent } : {}),
    ...(opts.modelID ? { modelID: opts.modelID, providerID: opts.providerID ?? "openai" } : {}),
  };
}

function part(type, extra = {}) {
  return {
    id: `prt_rich_${String(++partN).padStart(3, "0")}`,
    sessionID: SESSION,
    messageID: "PLACEHOLDER",
    type,
    ...extra,
  };
}

const messages = [];

function push(entry) {
  for (const p of entry.parts) p.messageID = entry.info.id;
  messages.push(entry);
}

function textPart(text, extra = {}) {
  return part("text", { text, time: { start: t, end: t }, ...extra });
}

// ---- Day 1: a long architecture Q&A with code fences + tables ----
push({
  info: info("user", {}),
  parts: [
    textPart("请解释一下这个项目的整体架构，包括 Tauri 壳、SolidJS 前端和 Rust 后端的职责划分。"),
  ],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    part("reasoning", {
      text: "用户想了解整体架构。项目是 Tauri 2 + SolidJS。需要分层说明：Rust 侧负责 IPC/HTTP 传输，前端负责渲染与状态。",
      time: { start: t, end: t },
    }),
    textPart(
      [
        "## 项目架构总览",
        "",
        "opencoder 是一个 **Tauri 2 + SolidJS** 的桌面客户端，通过 HTTP + SSE 与 OpenCode 服务器通信。",
        "",
        "### 三层职责",
        "",
        "| 层 | 技术 | 职责 |",
        "|---|---|---|",
        "| 壳层 | Rust (Tauri) | 窗口、系统托盘、HTTP 传输（`http_request` invoke）、SSE 订阅 |",
        "| 状态层 | SolidJS stores | 归一化消息存储、会话/项目/服务器注册表、细粒度响应式 |",
        "| 渲染层 | SolidJS 组件 | 虚拟化消息流、Markdown/代码高亮、工具卡片、diff 视图 |",
        "",
        "### 数据流",
        "",
        "```ts",
        "// 消息从 SSE 事件进入归一化 store",
        "subscribeToServerEvents(serverId, (event) => {",
        "  switch (event.type) {",
        '    case "message.part.delta":',
        "      applyPartDelta(serverId, event.partID, event.field, event.delta);",
        "      break;",
        '    case "message.part.updated":',
        "      upsertPart(serverId, event.part);",
        "      break;",
        "  }",
        "});",
        "```",
        "",
        "> **要点**：消息列表是虚拟化的，每行按消息 id 测量高度；流式期间只更新命中的 part 行。",
        "",
        "完整时序：",
        "",
        "1. 前端 `POST /session/{id}/prompt` 发送提示词",
        "2. 服务器回 `session.status: busy`",
        "3. 服务器流式推送 `message.part.delta` / `message.part.updated`",
        "4. 完成后推送 `session.status: idle`",
        "",
        "有任何一层想深入的话告诉我。",
      ].join("\n"),
    ),
  ],
});

// ---- Day 1: user asks for a bash example, tool call round ----
push({
  info: info("user", {}),
  parts: [textPart("那给我看一下 bash 工具调用的示例，包括输入和输出长什么样？")],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    textPart("这是一个完整的 bash 调用："),
    part("tool", {
      callID: "call_rich_001",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls -la src/ && du -sh src/" },
        output:
          "total 96\ndrwxr-xr-x  16 user  staff   512B Aug  7 10:00 .\ndrwxr-xr-x   9 user  staff   288B Aug  7 10:00 ..\ndrwxr-xr-x   7 user  staff   224B Aug  7 10:00 components\ndrwxr-xr-x   9 user  staff   288B Aug  7 10:00 features\ndrwxr-xr-x   4 user  staff   128B Aug  7 10:00 services\n 96K\t./src",
        title: "bash",
        metadata: { exit: 0 },
        time: { start: t, end: t },
      },
    }),
    textPart("如你所见，输出是纯文本，`exit: 0` 表示成功。"),
  ],
});

// ---- Day 1: a failed tool call with error state ----
push({
  info: info("user", {}),
  parts: [textPart("如果命令失败会显示什么？")],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    textPart("失败的工具调用会进入 `error` 状态，错误信息展示在卡片里："),
    part("tool", {
      callID: "call_rich_002",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "cat /nonexistent/file.txt" },
        output: "",
        error: "cat: /nonexistent/file.txt: No such file or directory",
        title: "bash",
        metadata: { exit: 1 },
        time: { start: t, end: t },
      },
    }),
    textPart("此时 `exit: 1`，错误信息用等宽字体显示在展开内容中。"),
  ],
});

// ---- Day 2: a read + edit round with file and patch parts ----
push({
  info: info("user", {}),
  parts: [
    textPart("帮我看看 src/features/messages/MessageList.tsx 里滚动相关的代码，并建议改进。"),
  ],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    textPart("我先读取这个文件："),
    part("tool", {
      callID: "call_rich_003",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "src/features/messages/MessageList.tsx", offset: 300, limit: 80 },
        output:
          "export function handleScroll(event: Event) {\n  const el = event.currentTarget as HTMLDivElement;\n  list.onScroll(el);\n  if (Date.now() < suppressUntil) return;\n  if (list.scrollTop() <= EARLIER_TRIGGER_PX) {\n    void loadEarlier();\n  }\n  const nearBottom = list.totalHeight() - list.scrollTop() - list.viewport() <= 80;\n  if (nearBottom) {\n    if (hasNew()) setHasNew(false);\n    setPaused(false);\n  } else {\n    setPaused(true);\n  }\n}",
        title: "read",
        metadata: {},
        time: { start: t, end: t },
      },
    }),
    textPart("滚动处理看起来合理，但 `nearBottom` 用的是虚拟列表的估算总高。我建议一个改进："),
    part("file", {
      filePath: "src/features/messages/MessageList.tsx",
      content: "const nearBottom = list.totalHeight() - list.scrollTop() - list.viewport() <= 80;",
      time: { start: t, end: t },
    }),
    part("patch", {
      filePath: "src/features/messages/MessageList.tsx",
      patch:
        "--- a/src/features/messages/MessageList.tsx\n+++ b/src/features/messages/MessageList.tsx\n@@ -374,7 +374,7 @@\n-    const nearBottom = list.totalHeight() - list.scrollTop() - list.viewport() <= 80;\n+    // Use the REAL scroll metrics: the virtual total lags measured heights\n+    // while rows hydrate, so the near-bottom check must read the container.\n+    const nearBottom =\n+      (el.scrollHeight ?? list.totalHeight()) - el.scrollTop - el.clientHeight <= 80;\n",
      time: { start: t, end: t },
    }),
    textPart("这个改动把 near-bottom 判定切到容器的真实滚动度量，避免虚拟总高滞后导致的误判。"),
  ],
});

// ---- Day 2: snapshot + subtask round ----
push({
  info: info("user", {}),
  parts: [textPart("现在给我生成一份 Heartbeat 服务的接入文档，就是之前讨论的 SSE 流式接口。")],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    part("reasoning", {
      text: "用户要一份完整的接入文档。需要包含 curl 示例、浏览器 JS 示例、连接生命周期、数据格式、限制。这是纯文档任务，直接产出。",
      time: { start: t, end: t },
    }),
    textPart(
      [
        "# Heartbeat 配置开启与关闭",
        "",
        "## curl（推荐）",
        "",
        "```bash",
        "# 连接并接收所有数据（含最近5分钟历史）",
        "curl -N http://localhost:5076/api/stream/amaninfo",
        "",
        "# 过滤特定航班",
        'curl -N "http://localhost:5076/api/stream/amaninfo?acid=OTC7294"',
        "",
        "# 仅实时，不推送历史",
        'curl -N "http://localhost:5076/api/stream/amaninfo?historyMinutes=0"',
        "```",
        "",
        "## 浏览器 JS",
        "",
        "```javascript",
        "const es = new EventSource('/api/stream/amaninfo?historyMinutes=1');",
        "es.onmessage = (e) => console.log(JSON.parse(e.data));",
        "es.onerror = () => console.log('disconnected');",
        "```",
        "",
        "## 连接生命周期",
        "",
        "1. 客户端连接",
        "2. 服务端从 DB 查最近 N 分钟的历史数据，按 `ReceivedAt` 升序逐条推送",
        "3. 历史数据发完后，切换到实时模式——每条新 UDP 数据通过 `StreamService<AmanInfo>.Broadcast()` 实时推送",
        "4. 客户端断开或超时，服务端清理会话",
        "",
        "## 数据格式",
        "",
        "每条 SSE 消息：",
        "",
        "```",
        'data: {"id":0,"receivedAt":"2026-07-03T10:57:52.292658Z","acid":"OTC7294","adep":"ZPLJ","ades":"ZGHA","amanSequence":12}',
        "```",
        "",
        "## 限制",
        "",
        "- 最大 100 个并发连接（超了返回 503）",
        "- 历史最多 1000 条",
        "- 前端缓存上限 500 条（FIFO）",
        "",
        "## 开启/关闭",
        "",
        "| 动作 | 配置 | 生效方式 |",
        "|---|---|---|",
        "| 开启 | `heartbeat.enabled = true` | 重启服务 |",
        "| 关闭 | `heartbeat.enabled = false` | 重启服务 |",
        "",
        "> ⚠️ 关闭后客户端将无法收到实时推送，历史查询不受影响。",
      ].join("\n"),
    ),
    part("snapshot", {
      filePath: "docs/heartbeat-sse.md",
      content: "# Heartbeat SSE 接入文档\n\n见上方消息内容。",
      time: { start: t, end: t },
    }),
  ],
});

// ---- Day 2: user asks for a sub-task split ----
push({
  info: info("user", {}),
  parts: [textPart("把这个文档拆成两个子任务：一个写客户端接入，一个写服务端配置。")],
});
push({
  info: info("assistant", { agent: "plan", modelID: "gpt-5", done: true }),
  parts: [
    textPart("好的，拆成两个子任务并行推进："),
    part("subtask", {
      sessionID: "ses_rich_02",
      title: "客户端 SSE 接入文档",
      summary: "curl 与浏览器 EventSource 示例、数据格式、连接生命周期",
      time: { start: t, end: t },
    }),
    part("subtask", {
      sessionID: "ses_rich_03",
      title: "服务端 Heartbeat 配置文档",
      summary: "heartbeat.enabled 配置项、限制参数、开启/关闭步骤",
      time: { start: t, end: t },
    }),
    textPart("两个子任务已建好，点击卡片可以跳转。"),
  ],
});

// ---- Day 2: compaction notice ----
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    part("compaction", {
      time: { start: t, end: t },
    }),
    textPart("（上下文已压缩）之前的讨论摘要：已产出 Heartbeat SSE 接入文档与两个子任务。"),
  ],
});

// ---- Day 3: retry + agent part + more tool calls ----
push({
  info: info("user", {}),
  parts: [textPart("这个 API 又超时了，帮我重试一下，另外看看 agent 切换的记录。")],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    part("retry", {
      retriedMessageID: "msg_rich_14",
      reason: "API 超时，自动重试",
      time: { start: t, end: t },
    }),
    part("agent", {
      from: "build",
      to: "plan",
      time: { start: t, end: t },
    }),
    textPart("已切换 agent，重新执行："),
    part("tool", {
      callID: "call_rich_004",
      tool: "glob",
      state: {
        status: "completed",
        input: { pattern: "docs/*.md" },
        output: [
          "docs/PLAN.md",
          "docs/architecture.md",
          "docs/AGENT_PLAYBOOK.md",
          "docs/testing.md",
          "docs/heartbeat-sse.md",
        ],
        title: "glob",
        metadata: { count: 5 },
        time: { start: t, end: t },
      },
    }),
    part("tool", {
      callID: "call_rich_005",
      tool: "grep",
      state: {
        status: "completed",
        input: { pattern: "heartbeat", include: "docs/**" },
        output: [
          "docs/heartbeat-sse.md:1:# Heartbeat SSE 接入文档",
          "docs/heartbeat-sse.md:12:heartbeat.enabled = true",
        ],
        title: "grep",
        metadata: { count: 2 },
        time: { start: t, end: t },
      },
    }),
    textPart("重试完成，相关文件都在 `docs/` 下。"),
  ],
});

// ---- Day 3: pending tool call (running state) ----
push({
  info: info("user", {}),
  parts: [textPart("再跑一次全量测试看看结果。")],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5" }),
  parts: [
    textPart("正在运行测试套件："),
    part("tool", {
      callID: "call_rich_006",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "pnpm verify" },
        title: "bash",
        time: { start: t },
      },
    }),
  ],
});

// ---- Day 3: a long multi-part answer with many code fences ----
push({
  info: info("user", {}),
  parts: [
    textPart("最后，帮我总结一下 Rust 侧的 HTTP 传输和 SSE 订阅是怎么实现的，给出关键代码。"),
  ],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    part("reasoning", {
      text: "总结 Rust 侧实现。关键点：tauri command、reqwest 客户端、SSE 事件流转发到前端。",
      time: { start: t, end: t },
    }),
    textPart(
      [
        "## Rust 侧传输实现",
        "",
        "### 1. HTTP 传输（`http_request` command）",
        "",
        "```rust",
        "#[tauri::command]",
        "pub async fn http_request(request: TransportRequest) -> Result<HttpResponse, String> {",
        "    let client = reqwest::Client::new();",
        "    let mut builder = client",
        "        .request(Method::from_str(&request.method)?, request.url)",
        "        .timeout(Duration::from_secs(request.timeout_ms.unwrap_or(30)));",
        "    if let Some(body) = &request.body {",
        "        builder = builder.json(body);",
        "    }",
        "    let response = builder.send().await.map_err(|e| e.to_string())?;",
        "    let status = response.status().as_u16();",
        "    let headers = response",
        "        .headers()",
        "        .iter()",
        '        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))',
        "        .collect();",
        "    let body_text = response.text().await.map_err(|e| e.to_string())?;",
        "    Ok(HttpResponse { status, headers, body_text })",
        "}",
        "```",
        "",
        "### 2. SSE 订阅",
        "",
        "```rust",
        "pub struct SseSubscription {",
        "    pub id: u32,",
        "    pub stream: mpsc::UnboundedReceiver<ServerEvent>,",
        "}",
        "",
        "#[tauri::command]",
        "pub async fn sse_subscribe(app: AppHandle) -> Result<u32, String> {",
        "    let (tx, rx) = mpsc::unbounded_channel();",
        "    let id = next_subscription_id();",
        "    subscriptions.lock().unwrap().insert(id, tx);",
        "    Ok(id)",
        "}",
        "```",
        "",
        "### 3. 事件转发到 WebView",
        "",
        "```rust",
        "// 服务器推送的每条 SSE 事件都被转换为 Tauri event 发出",
        'app.emit(&format!("server-event-{id}"), &event).ok();',
        "```",
        "",
        "| 组件 | 文件 | 说明 |",
        "|---|---|---|",
        "| `http_request` | `src-tauri/src/commands/http.rs` | 通用 HTTP 代理 |",
        "| `sse_subscribe` | `src-tauri/src/commands/sse.rs` | SSE 订阅管理 |",
        "| 事件桥 | `src-tauri/src/events.rs` | Tauri event → 前端 listener |",
        "",
        "需要我深入某个部分吗？",
      ].join("\n"),
    ),
    part("tool", {
      callID: "call_rich_007",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "src-tauri/src/commands/sse.rs", offset: 1, limit: 40 },
        output:
          "pub struct SseSubscription {\n    pub id: u32,\n    pub stream: mpsc::UnboundedReceiver<ServerEvent>,\n}\n\n#[tauri::command]\npub async fn sse_subscribe(app: AppHandle) -> Result<u32, String> {\n    let (tx, rx) = mpsc::unbounded_channel();\n    let id = next_subscription_id();\n    subscriptions.lock().unwrap().insert(id, tx);\n    Ok(id)\n}",
        title: "read",
        metadata: {},
        time: { start: t, end: t },
      },
    }),
    textPart("以上就是传输层的核心实现。"),
  ],
});

// ---- Day 3: one more user message to keep the list long ----
push({
  info: info("user", {}),
  parts: [textPart("好的，今天的讨论先到这里，明天继续。")],
});
push({
  info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
  parts: [
    textPart(
      "没问题！明天见。今天的产出：架构说明、Heartbeat SSE 文档、传输层代码总结，以及两个进行中的子任务。",
    ),
  ],
});

// Add a big pile of filler messages so the transcript is long enough to
// exercise virtualized scrolling (matching the user's "大量对话" ask).
for (let i = 0; i < 40; i++) {
  push({
    info: info("user", {}),
    parts: [
      textPart(
        `填充问题 ${i + 1}：这一段是第 ${i + 1} 条较长的问题，用来撑起会话长度，便于验证虚拟列表在大量消息下的滚动与测量表现。`,
      ),
    ],
  });
  push({
    info: info("assistant", { agent: "build", modelID: "gpt-5", done: true }),
    parts: [
      textPart(`这是第 ${i + 1} 条回答。包含一段示例代码：`),
      part("tool", {
        callID: `call_rich_fill_${i}`,
        tool: "bash",
        state: {
          status: "completed",
          input: { command: `echo "fill ${i + 1}"` },
          output: `fill ${i + 1}\n`,
          title: "bash",
          metadata: { exit: 0 },
          time: { start: t, end: t },
        },
      }),
      textPart(
        [
          "```ts",
          `// filler ${i + 1}`,
          `export function filler${i + 1}(): string {`,
          `  return "filler-${i + 1}";`,
          "}",
          "```",
        ].join("\n"),
      ),
      textPart(`回答结束（第 ${i + 1} 条）。`),
    ],
  });
}

writeFileSync(OUT, JSON.stringify(messages, null, 2));
console.log(`wrote ${messages.length} messages (${msgN} infos, ${partN} parts) -> ${OUT}`);
