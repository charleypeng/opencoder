# 聊天呈现形态改版实施方案（思考 · 模型显示 · 回复内容）

- 状态：Draft（待评审后执行）
- 日期：2026-09-06
- 适用范围：`src/features/messages`、`src/features/models`、`src/features/sessions`、`src/stores/models.ts`、`src/styles`
- 本方案是独立成稿的全新方案，未引用本目录下其他文档；实现所需的全部背景都在本文内。

---

## 0. 一句话目标

把助手回复的呈现形态改成参考录屏的样子：

1. **思考**：一条“已处理 N秒 / 用时 N秒”的灰色标题行（带贯穿整栏的细分隔线），运行中秒数每秒递增；思考内容以灰色单行摘要内联穿插在正文之间，完成后自动折叠进标题行，点箭头可展开。
2. **模型显示**：输入框右下角一个无边框的纯文本按钮“模型名 推理强度 ⌄”，点击打开模型/强度选择。
3. **回复内容**：助手消息无气泡、全宽 markdown 排版；用户消息是右侧灰色圆角胶囊；流式文字逐段淡入；工具调用内联成单行小条目（“正在运行 / 已运行 …”）。

---

## 1. 参考录屏形态拆解（目标规格）

录屏里的一个完整回合长这样（ASCII 示意）：

```
│                              思考久一点   │ ← 用户消息：右对齐灰色胶囊，无时间戳
│                                          │
│ 已处理 8秒                            ⌄  │ ← 运行标题：小灰字，秒数每秒 +1
│ ──────────────────────────────────────── │ ← 全宽 hairline 分隔线
│ 正在思考                                  │ ← 尚无思考内容时的灰色占位
│                                          │
│ 为什么“选择越多”有时反而让人更难做决定？      │ ← 正文：全宽 markdown，新文字淡入
│ 因为选择增加了潜在收益，……                  │
│ ⟳ 正在运行 git diff --stat             ⌄  │ ← 工具行（运行中：spinner + 现在进行时）
│ Planning safe read-only repo inspection ⌄│ ← 思考行：灰色单行摘要，可展开
│ ▣ 已运行 git status --short            ⌄  │ ← 工具行（完成）
│ 所以，好的 AI 不应该……                     │
│                                          │
│ 用时 8秒                              ⌄  │ ← 完成后：标签切到“用时”，思考自动折叠
│ ──────────────────────────────────────── │
│ 答案正文……                                 │
│ ⧉  👎  ↻                                 │ ← 完成后浮现的轻量操作图标
```

### 1.1 思考区（Run Header + 思考行）

| 状态 | 标题行 | 下方内容 |
| --- | --- | --- |
| 运行中、还没有思考内容 | `已处理 N秒`（每秒递增，微光 shimmer） | 灰色占位“正在思考” |
| 运行中、有思考内容 | `已处理 N秒` | 正文 / 工具行 / 思考行按时间顺序内联；活跃的思考行 shimmer |
| 已完成 | `用时 N秒` + 尾部展开箭头 `⌄` | 思考行全部隐藏（自动折叠）；正文与工具行保持可见 |
| 失败/需注意 | 现有 needs-attention 文案 | 同上 |

- 标题行视觉：`text-fg-faint`、`text-sm`、无前导箭头符号，底部 `border-b` 贯穿整个阅读栏；点击标题行切换“思考行可见性”。
- 思考行视觉：灰色（`text-fg-faint`）单行截断文本（取该段 reasoning 的首行/摘要），行尾小箭头；点击经 `AnimatedDisclosure` 展开完整 reasoning 散文（`text-sm text-fg-secondary`，无背景盒子）。
- 思考行的**显隐由标题行统一控制**；单个思考行的展开/收起只控制它自己的正文。
- 历史回合（重新打开会话）默认折叠，与录屏里已完成的旧回合一致。

### 1.2 模型显示（Composer）

- 位置：输入区**底部一行、右侧**，紧挨发送/停止按钮的左边：`模型名 强度 ⌄`。
- 视觉：无边框纯文本，`text-fg-secondary`，hover 变 `text-fg-primary`；强度标签用浅一档颜色。
- 点击打开模型选择器（复用现有 ModelPicker 对话框），其中新增“推理强度”分组（仅当该模型在目录里带 `variants` 时显示）。
- 录屏中“极高”即模型目录里的 variant（如 `xhigh`/`max`）；不选 = 服务端默认。

### 1.3 回复内容形态

- **助手消息**：无气泡、无头像、无可见时间戳，全宽 markdown（行距放宽到 ~1.75，段距略增）。流式时新追加的文字以浅色淡入到正常色（逐段观感，见 §5.3 实现方式）。
- **用户消息**：右对齐、中性灰底圆角胶囊（不再用品牌色浅底），超长内容保留现有折叠逻辑。
- **工具行**：单行内联。运行中 = spinner + “正在运行 `<目标>`”（现进行时）；完成 = 状态图标 + “已运行 `<目标>`”；目标用等宽字体；不再在行尾显示耗时（耗时留在展开详情里）；行尾箭头展开详情。
- **消息操作**：沿用现有 hover “⋯” 与右键菜单（复制/编辑/删除/fork/revert），不加气泡式工具条；完成后消息下方保持安静（录屏底部的小图标组与本应用现有交互不冲突，暂不新增）。
- **回合小结（RunOutcome：改动文件/命令统计）**：录屏没有对应物。本方案保留它，放在回合末尾，样式不变（功能对 opencode 有价值）。★待确认项 Q2。

---

## 2. 现状 → 目标 差距清单（文件级）

| # | 差距 | 现状位置 | 目标 |
| --- | --- | --- | --- |
| G1 | 过程件（reasoning/tool/retry/compaction）被抽走、整块渲染在正文**之前**；中途消息的 text 也被收进折叠体 | `src/features/messages/activity/agentRun.ts:52-71`（`finishRun` 把 parts 拆成 `partIds`/`activityPartIds`）、`src/features/messages/MessageBubble.tsx:219-235、284-293` | 全部 parts 按**原始时间顺序**单列渲染；思考件穿插在正文之间 |
| G2 | 标题行 = 前导 `▸` + shimmer 文案，折叠体是一个大容器 | `src/features/messages/parts/ProcessFold.tsx:180-273` | 标题行降级为纯文本 + 尾部 `⌄` + 全宽分隔线；标题行只控制思考行显隐；文件更名为 `RunHeader.tsx` |
| G3 | 思考行 = `▸ 思考` + 首行预览；reasoning 正文带灰色底盒 | `ProcessFold.tsx:76-115`（ThoughtDisclosure）、`parts/ReasoningPart.tsx:18-27` | 思考行 = 灰色单行摘要 + 行尾箭头；reasoning 正文为无底盒散文 |
| G4 | 工具行 = `▸` + 双图标 + 摘要 + 行尾耗时；运行中也用过去时文案 | `parts/ToolPart.tsx:202-239`、i18n `toolSummary*` | 单图标（运行中 spinner）、去掉行尾耗时、新增现进行时文案（“正在运行 …”） |
| G5 | 模型芯片在输入框上方工具栏（带边框，显示 provider 名） | `src/features/sessions/PromptBox.tsx:1207-1224` | 移到发送行右端：无边框“模型名 强度 ⌄”，点击开 ModelPicker |
| G6 | `ModelRef` 无 variant 维度；发送体不带 variant | `src/stores/models.ts:19-22`、`src/features/sessions/sendPrompt.ts:47,69-71,98` | `ModelRef` 增加可选 `variant`；`prompt_async` 请求体携带顶层 `variant`（契约已支持，见 §7 预检） |
| G7 | 流式只有呼吸光标，无淡入效果 | `parts/TextPart.tsx`、`markdown/MarkdownText.tsx`、`TypingCursor.tsx` | 新追加文本淡入（保留光标）；reduced-motion 下退化为纯光标 |
| G8 | 用户气泡用品牌色浅底 `bg-accent-soft`；每条消息下显示 `hh:mm` 时间戳 | `MessageBubble.tsx:277-282、323-327` | 中性灰胶囊；移除可见时间戳（耗时信息在标题行里） |
| G9 | 阅读栏排版 1.65 行距 | `src/features/messages/markdown/markdown.css:8-12`、`MessageList.tsx:590`（`max-w-[58rem]`，928px ≈ 录屏栏宽，保持不变） | 行距 1.75、段距略增 |

已经与录屏一致、无需改动的点（避免误伤）：

- 标题行文案：`messages:activityWorkingFor` = “已处理 {{duration}}”、`messages:activityWorkedFor` = “用时 {{duration}}”，与录屏逐字一致。
- 完成态工具行文案：`messages:toolSummaryRun` = “已运行 {{target}}” 等。
- 秒数每秒递增的计时器（`ProcessFold.tsx:157-161` 的 1s interval）、`AnimatedDisclosure` 折叠动画、`chat-status-shimmer` 微光、虚拟列表与底部跟随、Agent 芯片（录屏没有对应物，保留在工具栏，见 Q1）。

---

## 3. 总体设计决策

1. **时间顺序单列渲染**（替代“过程折叠体 + 正文”两段式）：`agentRun.ts` 的 `finishRun` 不再拆分，产出单一按序 `partIds`（含 text/reasoning/tool/file/patch/snapshot/retry/compaction）。`allPartIds` 与 `partIds` 合并（RunOutcome 数据源不变）。`activityPartIds` 字段删除，`MessageList.tsx` 的行缓存比较（`rows()` 中对 `activityPartIds` 的引用比较）同步去掉一项。
2. **思考显隐状态放在回合级**：一个回合 = 一个 `MessageBubble` 实例（虚拟列表按行挂载），所以“思考行是否可见”用 `MessageBubble` 内的局部 signal 承载，初始值 = `active ? true : false`，并通过现有 `activityViewState`（`readActivityExpanded`/`writeActivityExpanded`，按 runKey 持久化）在重挂载/历史回放时还原。**完成沿**：`createEffect` 监听 `active` 从 true→false，若用户没有手动切换过（`userToggled` 标记）则自动折叠并写回持久化。手动切换后以用户为准。
3. **ProcessFold 拆解**：文件更名为 `parts/RunHeader.tsx`，只保留标题行（计时 + 状态文案 + 尾部箭头 + 分隔线），不再拥有 body；ThoughtDisclosure 提升为独立组件 `parts/ThoughtRow.tsx`（灰色单行 + `AnimatedDisclosure` 包 `ReasoningPart`）；ToolPart/RetryPart/CompactionPart 由 `MessageBubble` 的分发表直接按序渲染。
4. **“working”占位行**（会话忙但助手消息未到，`MessageList.tsx:592-602`）：渲染 `RunHeader(active, startedAt)` + “正在思考”占位，无其他内容。
5. **variant 是可选维度**：目录里 `Model.variants` 为空的模型完全不出现强度 UI；发送体仅在用户显式选择时携带 `variant`（不传 = 服务端默认）。已知 id 做本地化标签映射，未知 id 原样展示。
6. **不追求逐帧复刻**：录屏里工具行/思考行的确切字号字色以本应用设计 token（`fg-faint/fg-secondary`）表达同等层级，不引入新颜色。

---

## 4. 分阶段实施（4 个提交，每个独立可验证）

> 执行约定（本仓库硬性规则，逐条适用于每个提交）：一次提交只做一个逻辑变更；改动与测试同包；提交前跑完整验证门 `pnpm verify`（必须 11/11 通过，不得绕过或削弱任何检查）；涉 chat 渲染的提交额外跑 `pnpm test:e2e`；用户可见变化在同一提交里同步更新 `CHANGELOG.md` 与 `CHANGELOG-zh.md` 的 `[Unreleased]`（条目带 `type(scope):` 前缀，无任务卡号则以子系统署名）；所有代码注释英文；i18n key 双语言文件同步增删（`pnpm check:i18n` 强制）。
>
> 预检：当前工作树有未提交的 `src/features/messages/parts/tools/EditCard.tsx` 与其快照改动，属其他工作线——实施时**不得**把它们卷进本方案任何提交。

### C1 — 回合按阅读顺序渲染（结构重构，纯行为等价 + 思考折叠语义）

**提交信息**：`refactor(messages): render assistant runs in reading order (messages)`

改动文件：
- `src/features/messages/activity/agentRun.ts`：`finishRun` 输出单一有序 `partIds`；删除 `activityPartIds`；`AgentRow` 相应收紧（`allPartIds` 并入 `partIds`）。
- `src/features/messages/MessageBubble.tsx`：删除 content/process 分组（`contentPartIds`/`processPartIds`/`isProcessPart`），改为对 `partIds` 单 `<For>` 按类型分发：text→TextPart、reasoning→ThoughtRow（受 `showReasoning` 控制）、tool→ToolPart、file/patch/snapshot/retry/compaction→各自 Part；`RunHeader` 渲染在流最前（仅助手行）；删除消息底部时间戳 span（G8 的可见时间戳部分，见 C3 也可，归入本提交一并删除并更新快照）。
  - 新增回合级状态：`const [showReasoning, setShowReasoning]`（初始读 `activityViewState`，默认 active→true/done→false）+ `active` 沿监听自动折叠 + `userToggled` 保护。
- `src/features/messages/parts/ProcessFold.tsx` → 更名 `src/features/messages/parts/RunHeader.tsx`：仅标题行（计时、状态文案、尾部 `⌄`、`border-b` 分隔线）；props 增加 `reasoningVisible`/`onToggleReasoning`；`aria-expanded`/`aria-controls` 指向思考区。
- 新增 `src/features/messages/parts/ThoughtRow.tsx`：`entry.preview`（首行）灰色单行 + 行尾箭头 + `AnimatedDisclosure` 内嵌 `ReasoningPart`；active 时 shimmer；无 preview 时回落 `messages:activityThinking`。
- `src/features/messages/MessageList.tsx`：`working` 兜底行改为 `RunHeader` + “正在思考”占位；行缓存比较去掉 `activityPartIds`。
- 测试：`agentRun.test.ts`（断言新的单一 partIds 输出与顺序）、`MessageBubble.test.tsx` + 快照、`MessageList.test.tsx`、`ProcessFold.test.tsx` → 更名 `RunHeader.test.tsx`（新增：完成沿自动折叠、手动切换优先、历史回合默认折叠）、新增 `ThoughtRow.test.tsx`。

验收：
- 流式回合中，思考行/工具行/正文段落严格按时间顺序穿插；完成后思考行消失、标题行变“用时 N秒”，点标题行可展开思考行。
- 既有功能不回归：复制/编辑/删除/fork/revert、revert 置灰、虚拟列表滚动跟随、`working` 占位。

### C2 — 过程件视觉重排版（标题行/思考行/工具行样式与文案）

**提交信息**：`feat(messages): restyle run header, thoughts and tool rows (messages)`

改动文件：
- `src/features/messages/parts/RunHeader.tsx`：视觉收敛——`text-fg-faint`、无前导符号、`flex` 左文案右箭头、`border-b border-bg-sunken`；失败态保留现有 `activityNeedsAttention`。
- `src/features/messages/parts/ThoughtRow.tsx`、`parts/ReasoningPart.tsx`：思考行 `text-fg-faint` 单行截断；`ReasoningPart` 去底盒，改 `text-sm leading-relaxed text-fg-secondary` 纯散文。
- `src/features/messages/parts/ToolPart.tsx`：去掉行首 `▸` 与行尾 duration（耗时移入展开详情首行）；运行中用 spinner + 现进行时文案（新增 i18n，见 §5）；完成后单状态图标 + 既有过去时文案；目标文本保持 `font-code`。
- `src/styles/index.css`：`.reply-tool` 行 hover 弱化；确认 reduced-motion 分支覆盖新增动画。
- 测试：`ToolPart.test.tsx` + 快照（断言运行中/完成两套文案、无行尾耗时）、`ThoughtRow.test.tsx` 视觉断言、`RunHeader.test.tsx`。

验收：与 §1.1/§1.3 规格逐条对齐；`pnpm verify` 通过。

### C3 — 流式淡入 + 用户胶囊 + 排版

**提交信息**：`feat(messages): fade in streamed text and neutralize user pill (messages)`

改动文件：
- `src/features/messages/markdown/MarkdownText.tsx`：流式淡入实现——组件持有上一次渲染的 HTML 串；新 HTML 到达时计算**最长公共前缀**（LCP，截断到最后一个 `>` 以防劈开标签），把剩余尾部包进 `<span class="md-stream-tail">`；CSS 对该 span 做 `md-tail-fade`（`opacity .25 → 1` + `color: var(--fg-faint) → var(--fg-primary)`，~450ms ease-out）。非流式渲染与 reduced-motion 下不启用。保留现有 TypingCursor。
  - 备选（若 LCP 方案在实测中出现明显重排抖动）：退化为容器底部 1.5em 的 `mask-image` 渐隐（视觉近似、零 JS）。二选一，在 PR 描述里注明选型。
- `src/features/messages/MessageBubble.tsx`：用户气泡类改为中性灰：`bg-bg-sunken`（替换 `bg-accent-soft`），圆角/内距不变。
- `src/features/messages/markdown/markdown.css`：`.markdown-body` 行距 1.65→1.75；`p` 边距 0.45em→0.6em。
- 测试：`MarkdownText.test.tsx`（新增：流式增量时尾部带淡入类、稳定前缀不带；LCP 不劈标签）、`MessageBubble.test.tsx` 快照更新。

验收：流式时新句子先浅后深、旧文不闪；用户消息为灰色胶囊；无可见时间戳。

### C4 — Composer 模型 + 推理强度显示

**提交信息**：`feat(models): show model and reasoning effort in the composer (models)`

改动文件：
- `src/stores/models.ts`：`ModelRef` 增加 `variant?: string`；`activeModelFor` 解析链保留 variant（session 回显的 model 契约里含 `variant?`，透传即可）；会话级记录 `activeBySession` 自然承载。
- `src/features/models/models.ts`：新增 `modelVariants(model): string[]` 与 `variantLabel(variant): string`（已知 id 本地化映射：`minimal→极简/Minimal`、`low→低/Low`、`medium→中/Medium`、`high→高/High`、`xhigh→极高/Ultra`、`max→极高/Max`；未知 id 原样）。
- `src/features/models/ModelPicker.tsx`：模型详情新增“推理强度”分区（仅当 `variants.length > 0`）：选项 = 不使用（默认）+ 各 variant，选中态打勾；选择写入 `ModelRef.variant`（清除 = 省略字段）。
- `src/features/sessions/PromptBox.tsx`：
  - 删除工具栏里的模型芯片（agent 芯片原位保留，见 Q1）；
  - 发送行（`+` 按钮 / textarea / 发送按钮所在行）右端、发送按钮左侧新增无边框文本按钮：`{modelChipName} {variantLabel} ⌄`（无 variant 时只显示模型名），点击 `setModelPickerOpen(true)`；沿用 `data-testid="model-chip"` 家族命名以便测试与录屏对照；
  - `send()`/`runShell()` 调用链传入 `modelRef().variant`。
- `src/features/sessions/sendPrompt.ts`、`sendShell.ts`：请求体增加顶层可选 `variant`（仅在有值时携带）。
- L3 契约测试：`pnpm mock:test` 下补一条 prompt_async 请求体带 `variant` 的断言（先确认 mock 服务器接受该字段；mock 不认识就先扩 mock，不允许为过测试削请求体）。
- 测试：`models.test.ts`（variantLabel/解析链）、`ModelPicker.test.tsx`（分区显隐、选择与清除）、`ModelPicker`/`PromptBox` 相关快照。

验收：选择带 variants 的模型（如 GPT-5.x 系）→ 输入框右下显示“模型名 极高 ⌄”；无 variants 的模型不出现强度；重进会话选择保持；发送请求体带/不带 variant 正确。

### 收尾

- 全部提交后跑一次完整 `pnpm verify` + `pnpm test:coverage`（services/stores 阈值不降）+ `pnpm test:e2e`。
- 两个 CHANGELOG 的 `[Unreleased]` 按提交分段补齐（见各提交条目），中文条目为英文条目的对译。

---

## 5. 技术细节

### 5.1 计时器与“已处理 N秒”

复用 `RunHeader` 现有实现：`active` 时 1s `setInterval` 刷新 `now`，文案 `activityWorkingFor(now - startedAt)`；完成后 `activityWorkedFor(completedAt - startedAt)`（`startedAt`/`completedAt` 已由 `agentRun` 从消息时间戳推导，busy 兜底 `busySince`）。秒数显示规则不变（<60s 显示秒，≥60s 显示分:秒）。**注意**：秒数变化每秒重渲染标题行一行文本，虚拟列表行高不变，不触发布局风暴；不要把 `now()` 读进行高相关路径。

### 5.2 思考行数据

`ThoughtRow` 的输入是 `deriveActivityTrace` 产出的 reasoning entry：`preview` = reasoning 首行（140 字截断），`status` 由 `part.time.end` 推导。展示规则：有 `preview` 显示 preview，否则显示 `messages:activityThinking`；`status === "active"` 时 shimmer。展开体 = `ReasoningPart`（流式 delta 直接反映在 store，正文随之增长）。

### 5.3 流式淡入的 LCP 细节

- LCP 在 **HTML 字符串**层面计算（markdown-it 输出对稳定前缀是确定性的）。
- 截断保护：`prefix = html.slice(0, commonLength)`，然后 `prefix = prefix.slice(0, prefix.lastIndexOf(">") + 1)`；若截断后为空（首 token 就是标签开头），整段作为 tail。
- tail 必须仍是合法 HTML 片段；用 `Set innerHTML` 一次写入 `${prefix}<span class="md-stream-tail">${tail}</span>`。若 tail 自身标签不配对（例如截在 `<strong>` 开标签后），浏览器容错渲染可接受（该 span 只存活到下一个 delta）。
- 完成帧（streaming 结束）重渲染一次**不带** tail span 的完整 HTML，确保最终 DOM 干净。
- 性能：每次 delta 一次字符串比较 O(n)，n 为该 part 的 HTML 长度；与现有 innerHTML 全量重写同量级，可接受。基准测试 `perf.bench.test.tsx` 跑一遍确认无回退。

### 5.4 CSS 新增（`src/styles/index.css`）

```css
/* Streamed markdown tail: newly appended text fades from faint to primary. */
.md-stream-tail {
  animation: md-tail-fade 450ms ease-out both;
}
@keyframes md-tail-fade {
  from { opacity: 0.25; color: var(--fg-faint); }
  to   { opacity: 1; color: var(--fg-primary); }
}
@media (prefers-reduced-motion: reduce) {
  .md-stream-tail { animation: none; }
}
```

复用既有 token/动画：`chat-status-shimmer`（运行中文案微光）、`AnimatedDisclosure`（思考行与工具详情展开）、`--dur-med/--ease-spring`。

### 5.5 variant 契约落点（已核对 1.18.11 生成类型）

- `Model.variants: { id: string; ... }[]`（模型目录，`schema.d.ts` Model 定义）。
- `session.prompt_async` 请求体顶层 `variant?: string`（与 `model: {providerID, modelID}` 平级）。
- `ModelRef`（会话/用户消息回显）：`{ id, providerID, variant? }`。
- 预检动作：实现 C4 前先跑 `pnpm gen:api:check` 确认 `src/services/api/schema.d.ts` 与契约一致（以上字段已在本方案撰写时核对存在）；若未来契约升级移除字段，以重新生成的类型为准回退 UI。

---

## 6. i18n 变更清单（两个文件同步，key 集合必须一致）

新增（`src/i18n/en.json` / `src/i18n/zh-CN.json`）：

| key | en | zh-CN |
| --- | --- | --- |
| `messages:activityThinkingPlaceholder` | `Thinking…` | `正在思考` |
| `messages:toolSummaryRunActive` | `Running {{target}}` | `正在运行 {{target}}` |
| `messages:toolSummaryReadActive` | `Reading {{target}}` | `正在读取 {{target}}` |
| `messages:toolSummaryEditActive` | `Editing {{target}}` | `正在编辑 {{target}}` |
| `messages:toolSummaryWriteActive` | `Writing {{target}}` | `正在写入 {{target}}` |
| `messages:toolSummarySearchActive` | `Searching {{target}}` | `正在搜索 {{target}}` |
| `messages:toolSummaryAskActive` | `Asking {{target}}` | `正在询问 {{target}}` |
| `messages:toolSummaryUseActive` | `Using {{target}}` | `正在使用 {{target}}` |
| `models:reasoningEffort` | `Reasoning effort` | `推理强度` |
| `models:effortDefault` | `Default` | `默认` |
| `models:variantMinimal` | `Minimal` | `极简` |
| `models:variantLow` | `Low` | `低` |
| `models:variantMedium` | `Medium` | `中` |
| `models:variantHigh` | `High` | `高` |
| `models:variantXHigh` | `Ultra` | `极高` |
| `models:variantMax` | `Max` | `极高` |

不改文案（已与录屏一致）：`messages:activityWorkingFor`（已处理 {{duration}}）、`messages:activityWorkedFor`（用时 {{duration}}）、`messages:toolSummaryRun` 等 7 条过去时摘要。
删除：无。

---

## 7. 测试与验证门

- **L1/L2（vitest）**：每个提交随改随测；重点新增用例：
  - agentRun：混合 parts（text/reasoning/tool 交错、多 assistant 消息、非末组 text）输出单一有序 partIds；
  - RunHeader：运行计时文案、完成文案、失败文案、`aria-expanded`；
  - 思考折叠：active→done 自动折叠、手动展开后保持、重挂载还原持久化值；
  - ToolPart：运行中 spinner + 现进行时文案、完成过去时、无行尾耗时；
  - MarkdownText：两连 delta 的 LCP/tail 划分、标签中点截断保护、结束后无 tail 残留；
  - models：variant 解析/透传/清除、variantLabel 回落。
- **L3（mock 契约）**：prompt_async 携带 `variant` 的请求体断言（C4）。
- **E2E（Playwright）**：C1–C4 合并后整跑 `pnpm test:e2e`；重点 journeys：发送消息→流式渲染→工具行出现→回合完成折叠；模型选择。
- **门禁**：`pnpm verify` 11/11；`pnpm test:coverage` 阈值不降（services/stores lines/functions/statements ≥80%，branches ≥70%）。
- **快照**：`MessageBubble`/`ToolPart` 等快照会大量更新——逐个人工审阅 diff 后再 `git add`，禁止盲批。

---

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| variant 并非所有 provider/model 都支持 | `variants` 为空即隐藏强度 UI；未选择就不发字段，行为与今天完全一致 |
| LCP 淡入在极端 delta（整段替换、代码块滚动）下闪烁 | §5.3 的截断保护 + 空前缀全 tail 兜底；实测不行就切 §C3 备选方案 |
| active→done 自动折叠与用户手动展开互相打架 | `userToggled` 一次性标记优先；持久化只写用户动作与自动折叠结果 |
| 虚拟列表行高在思考行显隐切换时跳变 | 显隐切换由用户点击触发（非流式高频路径），现有 measure/follow 机制消化；E2E 覆盖 |
| 快照大面积变更掩盖真回归 | 快照 diff 人工逐条审阅 + 语义断言（testid/文案）双保险 |
| 中文/en key 漂移 | `pnpm check:i18n` 在门禁里强制；新增 key 成对落地 |

---

## 9. 待确认问题（不阻塞 C1–C3，C4 前请拍板）

- **Q1 Agent 芯片**：录屏没有 agent 概念。建议保留现有工具栏 agent 芯片不动（本方案已按此设计）；若想完全复刻录屏，可把 agent 芯片也移入底部行，但这超出“模型显示”范围，需单独确认。
- **Q2 RunOutcome 回合小结**：录屏没有对应物。本方案保留在回合末尾；若你希望“完全像录屏”，可以把它收进标题行展开体或直接移除（移除会丢功能，不建议）。
- **Q3 可见时间戳**：本方案移除消息下方的 `hh:mm`（录屏没有；耗时信息已在标题行）。若你仍想保留，C1 里跳过对应小改动即可。
- **Q4 variant 标签文案**：“极高”同时映射 `xhigh` 与 `max` 是否可接受，或两者需区分（如“超高/极高”）。
