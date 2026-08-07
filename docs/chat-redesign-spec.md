# Chat 界面重做规格（Chat UI Redesign Spec）

> 版本：v1.0 · 2026-08-07 · 依据：`docs/ai-coding-chat-design-guidelines.md`（AI 聊天界面设计规范 v1.0，150+ 条规则）+ `docs/ui-design.md`（项目设计令牌与形态）+ `docs/openapi_v1.18.11.json`（API 契约）。
> 目标：把 opencoder 的 chat 界面重做到符合设计指南的 MUST 规则，同时保持现有功能与数据流不变。

---

## 1. 范围与分工

三个并行工作流，**文件所有权严格隔离**，不得越界修改（需要改共享文件时停下汇报，由协调者统一处理）：

| 工作流 | 文件所有权 | 职责 |
|---|---|---|
| **Desktop UI 专家** | `src/shells/desktop/**`、`src/features/sessions/PromptBox.tsx`、`src/features/sessions/SessionList.tsx`、`src/features/sessions/TodoPanel.tsx`、`src/features/sessions/SessionErrorBanner.tsx`、`src/features/sessions/ProjectSwitcher.tsx` | 桌面三栏中 chat 区域的 chrome：会话列表、chat 头部、PromptBox 视觉、状态栏、待办面板 |
| **Web/Rendering 专家** | `src/features/messages/**`（MessageList、MessageBubble、MessageActions、parts/*、markdown/*、TypingCursor）、`src/styles/**`（tokens.css、index.css）、`src/components/**` 通用组件 | 消息流渲染核心：气泡、代码块、工具卡片、diff、reasoning、markdown 渲染、设计令牌落地 |
| **Mobile UI 专家** | `src/shells/mobile/**`（ChatPage、PageHeader、MobileShell、pages、gestures、glass） | 移动端 chat 页面：玻璃拟态、安全区、手势、移动输入体验 |

**红线**：
- 不改 `src/services/**`、`src/stores/**`、`src/i18n/**` 的 key 结构（i18n key 可新增，必须 en+zh-CN 成对加到 `src/i18n/en.json` 与 `src/i18n/zh-CN.json`，`pnpm check:i18n` 必须过）。
- 不改 `src/features/messages/MessageList.tsx` 的对外 props 契约（mobile ChatPage 依赖 `mobile` prop）。
- 不破坏现有测试：所有现有 `*.test.tsx/ts` 必须继续通过（快照会变——如果组件 DOM 结构变化是有意的，更新快照并说明理由）。
- 注释用英文；用户可见字符串必须走 `useT()`/`t("ns:key")`。

## 2. 设计基线（统一令牌）

- 现有 `src/styles/tokens.css` 已定义：`--bg-base/elevated/sunken`、`--fg-primary/secondary/faint`、`--accent`、`--success/warning/danger`、玻璃材质、字阶、圆角、动效。**在此基础上扩展，不推倒重来**。
- Tailwind v4 桥接在 `src/styles/index.css` `@theme inline`，类名如 `bg-bg-base`、`text-fg-secondary`、`rounded-r-md`。
- 暗色为默认；`prefers-reduced-motion` 必须生效（动效走 `--dur-*` 令牌）。
- 桌面保持紧凑密度；信息层级用颜色与字号区分，不用边框堆砌。

## 3. 必须落地的设计指南规则（按组件）

### 3.1 消息流（MessageList / MessageBubble）

- **IA-01**：容器 `role="log"` + `aria-live="polite"` + `aria-atomic="false"`；流式朗读通知防抖（已有部分实现，补齐确认）。
- **IA-02/03**：滚动自主权已有（`paused`/`hasNew`/jumpToBottom），确认"回到底部"按钮样式符合指南（浮动的、可辨识的）。
- **IA-05**：用户/AI 消息视觉可区分（已有：用户右对齐气泡、助手无背景），**补：助手消息带持久 AI 标识**——在助手消息首条或头部区域显示"AI"/agent 名标识（小号、不喧宾夺主），满足 IBM-Carbon AI label 要求。
- **IA-07**：每条 AI 响应可溯源——工具调用可见（已有 ToolPart）。
- **时间戳**：保留小号时间戳；助手消息时间戳跟随消息底部，不抢视觉。

### 3.2 代码块（markdown / TextPart）

- **IA-08**：代码块必须有：语言标签 + 一键复制按钮；多文件场景带路径标识（PatchPart/FilePart 场景）。
- **IA-09**：语法高亮防抖 200–300ms（检查 `highlighter.ts` 实现，流式期间只对进行中的块降级）。
- **IA-10**：代码块提供"应用到文件/插入光标"直接动作（与复制并列；当前若只有复制，先保证复制+语言标签齐全，应用类动作标注为后续）。
- 代码块视觉：圆角容器、深一档背景（`--bg-sunken` 系）、头部条（语言标签 + 复制按钮）、行内代码用 accent 弱化底色。

### 3.3 工具调用（ToolPart）

- **IA-20**：四态子状态机视觉可区分：pending（灰、等待）、running（accent 脉冲/进度光）、completed（success 绿）、error（danger 红）——已有 StatusIcon，确认色值对比度达标（WCAG AA）。
- **IA-28**：紧凑/详细两级：默认收敛（工具名+状态+耗时），一键展开输入/输出（已有 expanded 机制，确认展开内容排版：input 用等宽字体、JSON 缩进）。
- **IA-19**：状态文本公式 = 动作词 + 对象 + 范围（如"正在运行 bash: npm test"），禁止空洞"正在思考"。工具标题已含工具名，补齐动作语义。

### 3.4 Diff 呈现（PatchPart / DiffView）

- **IA-13/14**：diff 统一格式、支持逐块查看（PatchPart 已有，视觉上用 `+` 绿 / `-` 红 / 上下文灰，行号等宽）。
- **IA-15**：diff 附带变更意图说明——PatchPart 若无意图文本展示区，检查数据是否携带；不带则留组件接口。

### 3.5 状态与进度

- **IA-18**：等待分级：<1s 无指示 / 1–3s spinner / >3s 描述文本 / >10s 进度+可中断（streaming progress bar 已有；`>3s` 描述性文本在 busy 时由消息流头部或状态文本承担）。
- **IA-21**：todo 待办清单（TodoPanel 已有）——视觉上作为"当前任务锚点"，可折叠。
- **IA-23**：上下文余量——StatusBarUsage 已有 tokens/cost；可增加"context left %"（数据来自 Session schema 的 tokens 字段，若无该字段则跳过，不编造）。

### 3.6 上下文可见性（IA-24/25）

- 用户必须能看到"AI 当前知道什么"：@-mention 已插入文件引用（FilePart），确认 FilePart 视觉：文件路径标识 + 类型图标 + 可辨识为"上下文条目"。若有"移除上下文"能力则提供；无 API 支持则只做展示。

### 3.7 输入区（PromptBox）

- 保留现有全部功能（agent/model 选择、附件、@、/ 命令、发送/停止、↑ 历史、Esc 中断）。
- **P1 人类掌控**：停止按钮在 busy 时显眼可用（已有 Stop）；发送按钮在空闲时主色、busy 时切换为停止样式。
- 视觉：输入区与消息流之间留白自然；聚焦态有清晰但克制的焦点环（已有全局 `:focus-visible`）。
- 附件 chips：可移除（已有）、显示文件名/类型。

### 3.8 错误处理（IF-12/14）

- 错误消息 = 什么失败 + 为什么 + 至少两条出路。检查 ErrorBanner/SessionErrorBanner 文案结构；技术细节折叠在"详细信息"中（有则保留，无则标注）。

### 3.9 移动端（Mobile UI 专家）

- 遵循 `docs/ui-design.md` §4/§5：底部 Tab、Bottom Sheet、玻璃拟态（`.glass` 类，同屏 ≤4 个）、安全区 `env(safe-area-inset-*)`、触控目标 ≥44px、`prefers-reduced-motion` 降级。
- ChatPage：玻璃输入条吸附键盘顶；消息气泡玻璃质感（iOS 26 Liquid Glass 三档方案的档位 B CSS 玻璃）。
- 会话切换、模型选择用 Bottom Sheet；右滑返回已有。

## 4. 数据能力（来自 openapi_v1.18.11.json，只读依据）

- Message 结构：`role: user|assistant`、`time.created`、`agent`、`model`、`summary`（title/body/diffs）、`parts[]`。
- Part 类型：`text`、`reasoning`、`tool`（state: pending/running/completed/error + input/output）、`file`、`patch`、`snapshot`、`subtask`、`agent`、`retry`、`compaction`、`step-start/step-finish`。
- Session：`title`、`slug`、`tokens`（input/output/reasoning/cache）、`cost`、`revert`、`agent`、`model`、`time`。
- SSE 事件：`message.updated`、`message.part.updated/delta/removed`、`message.removed`、`session.status`、`session.updated`、`todo.updated`、`permission.*`、`question.*`。
- 已有组件已覆盖上述类型的渲染（parts/*），**本次重点是视觉与交互质量，不是新增数据链路**。

## 5. 验收（每个工作流交付前自检）

1. `pnpm build` 通过（tsc + vite）。
2. 相关测试通过：`pnpm vitest run src/<自己的目录>`；改动涉及快照的更新快照并说明。
3. `pnpm check:i18n` 通过（新增 key 必须 en+zh 成对）。
4. 视觉自检：本地 `pnpm mock:start --cors --port 14096` + `VITE_TRANSPORT=fetch VITE_MOCK_BASE_URL=http://localhost:14096 pnpm dev`，浏览器打开 http://localhost:1420，进入 mock 服务器 workspace，打开会话（fixtures 自带消息），检查渲染效果。
5. 不越界修改其他工作流的文件；需要共享文件改动时在汇报中写明"需要协调"。

## 6. 交付汇报格式

每个工作流汇报：改动的文件清单 / 落地的指南规则编号 / 测试与构建结果（命令+输出摘要）/ 需要协调的事项 / 视觉自检截图或描述。
