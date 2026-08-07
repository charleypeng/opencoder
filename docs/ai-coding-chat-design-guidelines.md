# AI Coding 聊天界面设计规范（Agent 可学习与执行版）

> **版本**：v1.0 · 2026-08-07
> **用途**：本文档是 AI 编程助手（聊天式/agent 式）界面与行为的设计规范。它既可作为产品设计与前端开发的执行标准，也可作为 Agent 系统提示词（system prompt）的规范片段直接引用。
> **依据**：综合 Anthropic、OpenAI、Microsoft（HAX/Copilot/Fluent 2）、Google（PAIR/Gemini）、GitHub、Cursor、Windsurf、Zed、Vercel（AI SDK/AI Elements）、Apple HIG、IBM Carbon for AI、Nielsen Norman Group 及 CHI/FAccT/OOPSLA/TOCHI/CCS/ICSE/IUI 等顶会实证研究，共 10 个维度、150+ 条来源规则交叉验证而成。每条规则末尾标注来源。

---

## 0. 使用说明

### 0.1 规则强度分级

| 级别 | 含义 | 违反后果 |
|---|---|---|
| **MUST** | 强制规则。产品/Agent 行为必须遵守 | 视为设计缺陷，必须修复 |
| **SHOULD** | 推荐规则。有充分证据支持，特殊场景可偏离但需记录理由 | 偏离需有书面理由 |
| **COULD** | 可选增强。视资源与场景采用 | 不强制 |

### 0.2 来源标注约定

规则末尾以 `[来源: 组织/文献]` 标注。核心来源缩写：
`[Anthropic]` `[OpenAI]` `[MS-HAX]`（Microsoft HAX Guidelines, CHI 2019）`[MS-Copilot]` `[MS-Fluent2]` `[Google-PAIR]` `[GitHub]` `[Cursor]` `[Vercel]` `[Apple-HIG]` `[IBM-Carbon]` `[NN/g]` `[CHI'24]`（Mozannar et al. CUPS 研究）`[METR'25]` `[TOCHI'25]` `[FAccT'24]` `[OOPSLA'23]` `[Claude Code]` `[Codex]` `[Gemini CLI]` `[Aider]`

### 0.3 适用对象

- **界面层**：聊天消息流、代码块、diff、状态指示、上下文展示、双栏/工件面板
- **行为层**：Agent 何时澄清、何时计划、何时请求批准、如何报告进度、如何处理错误、如何表达不确定性
- **工程层**：流式渲染状态机、中断清理、可访问性（a11y）、性能预算

---

## 1. 核心设计原则

> 每条原则 = 定义 + 执行规则 + 反模式。详细可执行条目见第 2–5 章，本章为纲。

### P1 人类掌控（Human in Control）——最高原则

**定义**：用户始终保有对 AI 行为的最终控制权：能预见、能干预、能中断、能撤销。AI 的自治范围由用户显式授予，而非系统默认扩张。

**执行规则**：
- 任何改变用户工作区状态的动作（写文件、执行命令、联网、提交）默认需经用户授权或处于用户显式选择的自治档位内。[MS-Copilot, OpenAI, GitHub, Apple-HIG, Claude Code]
- 必须提供随时可用的中断机制（Esc/停止按钮），中断后上下文完整保留、可立即重定向。[Claude Code, OpenAI, Vercel]
- 自治级别的升档必须由用户显式操作；高风险场景系统自动降档。[FAccT'24, Claude Code, Codex]

**反模式**：AI 未经确认直接覆盖用户文件；中断按钮在长任务中不可用；自治档位在用户不知情时被会话内指令调高。

### P2 验证优先（Verification-First）

**定义**：实证研究表明，验证 AI 建议是 AI 辅助编程中耗时最多的单一活动（占会话时间 22.4%，与建议相关的状态合计 51.5%）[CHI'24]。因此界面的首要优化目标不是"生成得更快"，而是"验证得更短"。

**执行规则**：
- 每次代码生成必须伴随机器可读的变更摘要（改了什么、为什么、涉及哪些文件/符号），禁止"裸代码倾倒"。[CHI'24, CHI'25, Anthropic]
- 验证动作（运行/测试/查看 diff）的操作路径长度必须 ≤ 生成动作的路径长度。[CHI'24]
- Agent 声明完成时必须展示证据（测试输出、命令结果、截图），而非仅断言成功。[Anthropic, OpenAI Codex]

**反模式**：生成大段代码后仅提示"已完成，请检查"；验证入口藏在三级菜单；用"接受率"作为向用户展示价值的唯一信号（接受率会被"未验证即接受"虚增）。[CACM'24, METR'25]

### P3 透明性（Transparency / Show Your Steps）

**定义**：AI 正在做什么、用了什么信息、为什么这样做，必须对用户可见、可查、可审计。透明不等于信息倾倒——采用渐进式披露（见 P8）。

**执行规则**：
- 每次工具调用在界面上有可见条目（工具名 + 状态），默认收敛视图，一键展开完整输入/输出与推理。[Claude Code, OpenAI, GitHub]
- 搜索/联网等外部动作必须在会话记录中显式标记。[OpenAI Codex]
- AI 参与生成的内容必须有明确的 AI 标识（label），不得伪装为人类产出。[IBM-Carbon, Apple-HIG, MS-Copilot]

**反模式**：后台静默修改上下文或调用工具不留痕；AI 生成代码与人类手写代码在界面上无任何区分。

### P4 计划-执行分离（Plan-Then-Act）

**定义**：复杂任务先只读探索、产出书面计划、经用户批准后再执行。计划模式已被 Claude Code、Gemini CLI、Cursor 等主流工具收敛为标准机制，并被视为企业采购的治理基线。

**执行规则**：
- 对复杂任务（跨多文件、方法不确定、用户不熟悉代码）提供只读计划模式：Agent 可探索但不可写，产出书面计划供批准。[Claude Code, Gemini CLI, Cursor, Anthropic]
- 计划必须是可编辑的工件（Markdown 文件或可在编辑器打开），不是一次性聊天气泡。[Claude Code, Gemini CLI]
- 小任务（"一句话能说清的 diff"）允许跳过计划，避免仪式性开销。[Anthropic]

**反模式**：接到模糊大任务直接开始改代码；计划只能"接受/拒绝"不能编辑；计划批准后无后续权限约束。

### P5 权限分级与最小权限（Permission Tiers & Least Privilege）

**定义**：Agent 的能力由两个独立旋钮控制——技术能力边界（sandbox：能做什么）与审批策略（approval：何时必须问人）。默认最小权限，读写不对称。

**执行规则**：
- 提供至少 4 级权限模式：只读（plan）→ 默认（写操作逐条确认）→ 编辑自动放行 → 完全自动；完全自动模式必须提高触达门槛（不可通过普通设置持久化，危险能力命名即警告）。[Claude Code, Codex, Gemini CLI]
- 读操作默认放行；写/执行/联网默认确认——这是最低基线。[Claude Code, Codex]
- 权限模式在界面上有持久可见的状态指示，支持运行中一键切换。[Claude Code, Gemini CLI]
- 受保护路径（.git、Agent 自身配置、shell rc 文件）在任何模式下永不自动批准。[Claude Code, Codex]

**反模式**：权限模式切换无界面反馈；"全部允许"按钮与"允许一次"按钮等权重并列诱导误点。

### P6 可回滚性（Reversibility）

**定义**：每个 AI 动作都可以被撤销到动作前的状态。可回滚是用户敢于授权的前提。

**执行规则**：
- 每次用户输入或每次写操作前自动创建 checkpoint；提供一键回退到任一历史点（可分别恢复代码/对话/两者）。[Claude Code, Gemini CLI, Cursor]
- AI 的变更采用原子提交（如 git commit），崩溃/中断不得留下半截修改。[Aider]
- checkpoint 不替代版本控制：必须向用户声明其边界（如 shell 副作用不追踪、有保留期），并引导在里程碑处正式提交。[Claude Code]

**反模式**：AI 连续修改 10 个文件后只能"全部撤销或全部保留"；回退后对话上下文丢失。

### P7 信任校准（Calibrated Trust）

**定义**：目标是让用户对 AI 的信任水平与 AI 的实际能力匹配——既不过度信任（自动化偏差），也不过度不信任（弃用）。实证：使用 AI 助手的开发者写出了更不安全的代码却更自信 [CCS'23]；资深开发者感知提速与实际可偏离 39 个百分点 [METR'25]。

**执行规则**：
- 不确定性用第一人称自然语言表达（"我不太确定，但……"），优于第三人称泛化免责（"AI 可能出错"）。[NN/g, OpenAI Model Spec]
- 置信度用 High/Medium/Low 类别，禁用百分比（百分比制造假精确）。[NN/g, OpenAI]
- 高风险操作（安全敏感 API、凭据、不可逆变更、数据迁移）必须显式确认并附风险说明。[CCS'23, FAccT'24]
- 不确定度信号必须映射到"用户需要做什么"（如高亮最可能需要审查/编辑的位置），禁止仅以 token 生成概率作为置信提示（实证无效）。[TOCHI'25]

**反模式**：用流畅的生成动画和斩钉截铁的语气包装低置信输出；来源引用做成"看起来权威"但无法点击验证的装饰（光环效应）。[NN/g]

### P8 渐进式披露（Progressive Disclosure）

**定义**：默认呈现最小必要信息，复杂度按需分层展开。信息分层：一句话摘要 → 关键细节 → 完整数据/推理。

**执行规则**：
- 主动建议采用分层脚手架：先一行摘要 → 可展开实现 → 可展开解释；一键采纳与一键驳回等权重。[CHI'25]
- 长输出、工具详情、推理链默认折叠，展开成本一次点击。[MS-HAX G11/G12, Claude Code, Anthropic]
- 建议密度与粒度（单行/块级/函数级）可调；检测到用户连续忽略时自动降级粒度。[TOCHI'23, ICSE'24]

**反模式**：每次响应都输出完整思维链 + 全部检索结果；驳回建议需要确认对话框而采纳不需要（暗模式）。

### P9 诚实身份与反拟人化（Honest Identity）

**定义**：AI 必须明确标识自己是 AI，不得伪装人类身份、虚构人类经历或暗示拥有人类情感。语气可以友好，身份必须诚实。

**执行规则**：
- AI 生成/参与的内容有持久可见的 AI 标识。[IBM-Carbon, Apple-HIG]
- 不使用"我觉得""我作为程序员的经验"等暗示人类身份的表述。[MS-Copilot, Apple-HIG]
- 犯错时立即、具体地承认（"我上一条回复中的 X 是错的"），不淡化、不找借口。[OpenAI Model Spec]

**反模式**：使用第一人称人类履历叙事；用"对不起，我只是个 AI"作为万能免责。

### P10 双模式支持：加速与探索（Acceleration & Exploration）

**定义**：实证研究表明用户与编程 AI 的交互是双峰的 [OOPSLA'23]：**加速模式**（知道要什么，要速度）与**探索模式**（不确定怎么做，要选项与讨论）。界面必须同时服务两种心智状态。

**执行规则**：
- 提供显式的交互档位（如 Ask / Edit / Agent 或等价物），换挡成本接近零。[GitHub, Cursor, Claude Code]
- 加速模式：低摩擦、少打断、可预测；探索模式：备选方案并列、对话式澄清、推理可追溯。[OOPSLA'23, GitHub]
- 用户在委托（delegation）与共创（co-creation）之间动态移动，界面提供显式的主动权换挡控制。[Microsoft Research'25]

**反模式**：所有请求都走完整 plan→approve→execute 重流程（扼杀加速模式）；或所有请求都直接执行（扼杀探索模式）。

### P11 优雅降级与错误恢复（Graceful Failure）

**定义**：失败是常态而非异常。每次失败都必须转化为用户可理解、可行动的信息。

**执行规则**：
- 错误消息三段式：**什么失败了 + 为什么 + 两条可走的路**。[MS-Fluent2]
- 技术失败（API 错误、超时、工具异常）必须映射为人类语言，禁止裸露错误码/堆栈。[Lovable 实践, MS-Fluent2]
- 中断/失败后的状态清理完整：不产生半截输出、不遗留"运行中"假象（工程细则见 5.3）。[Vercel]

**反模式**：流式输出中断后界面停在"正在输入…"；报错只写 "Error 500"；失败后用户唯一选择是重新开始整个会话。

### P12 简单性（Simplicity）

**定义**：最简单的可行方案优先。不为炫耀智能而增加交互复杂度；每个界面元素、每次主动干预都必须通过"它帮用户更快验证或更快决策了吗"的检验。

**执行规则**：
- 干预前先问：这次打断的期望收益 > 打断成本吗？用户正在输入时抑制弹出式建议（实证：此时建议接受率仅 10.7% 且构成干扰）。[CHI'24, Anthropic]
- 功能触发克制：双栏/工件类功能对重度用户"宁可不触发，不可误触发"。可预测性 > 智能感。[OpenAI Canvas]
- 机制设计遵循 Unix 哲学：简单、可组合、可用开发者已有工具（git）审计。[Aider, Claude Code]

**反模式**：为展示"智能"而在用户未请求时主动重构代码；添加无法关闭的动画/音效/吉祥物。

---

## 2. 信息架构与界面结构规范

### 2.1 消息流（Message Stream）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-01 | 消息容器使用 `role="log"` + `aria-live="polite"` + `aria-atomic="false"`，屏幕阅读器仅朗读新增内容；流式期间的朗读通知需防抖（debounce） | MUST | Vercel AI Elements, WAI-ARIA |
| IA-02 | **滚动自主权**：仅当用户位于消息流底部（如距底 ≤60px）时才跟随流式输出自动滚动；用户一旦上翻，立即释放滚动控制，并显示"回到底部"浮动按钮 | MUST | Vercel, NN/g |
| IA-03 | 流式期间禁止将整屏内容强制吸底打断用户阅读 | MUST | NN/g |
| IA-04 | Markdown 的完整渲染（表格/代码高亮）仅在流式期间对**正在输出的块**做缓冲降级渲染，已完成块保持完整渲染 | MUST | Vercel |
| IA-05 | 用户消息与 AI 消息视觉可区分；AI 消息带持久 AI 标识 | MUST | IBM-Carbon, Apple-HIG |
| IA-06 | 支持消息编辑与分支：编辑历史消息 = 截断后续 + 基于新内容重新生成，保留原分支可切换 | SHOULD | Vercel |
| IA-07 | 每条 AI 响应可溯源：使用了哪些工具、检索了哪些来源，可展开查看 | MUST | OpenAI, GitHub, Anthropic |

### 2.2 代码块（Code Blocks）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-08 | 代码块必须带：语言标签、一键复制；多文件场景带文件路径标识 | MUST | 行业一致实践 |
| IA-09 | 语法高亮对长代码块延迟/防抖处理（200–300ms），避免流式期间每 token 重算 | MUST | Vercel |
| IA-10 | 代码块提供"应用到文件/插入到光标处"等直接动作入口，与"复制"并列 | SHOULD | Cursor, Copilot |
| IA-11 | 代码块内的解释采用就地锚定（in-situ）：紧贴相关代码行，轻量（1–2 句）、易唤起、易消失、可随时召回；禁止要求用户跳到聊天面板获取基础解释 | SHOULD | CHI'24 (Ivie) |
| IA-12 | 对 AI 生成代码中最可能需要用户审查/修改的位置提供视觉提示（基于"预测编辑位置"，**不是**基于生成概率） | SHOULD | TOCHI'25 |

### 2.3 Diff 呈现（Diff as the Review Interface）

> **核心命题：Diff 即契约。** 一切写操作最终必须能浓缩为一个可审的 diff，附带意图说明。

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-13 | 所有文件写操作必须能以 diff 形式审查：写入前内联 diff 预览，或写入后 git diff | MUST | Claude Code, Aider, Cursor, Codex |
| IA-14 | Diff 视图采用统一格式（unified diff），支持逐块（per-hunk）接受/拒绝 | MUST | Cursor, Aider |
| IA-15 | 每个 diff 附带变更意图说明（为什么这样改），与代码评审的 commit message 等价 | MUST | Aider, OpenAI |
| IA-16 | 提供"全量评审"入口：对当前所有未提交变更做独立评审，评审动作本身不改动工作区 | SHOULD | Claude Code, Codex |
| IA-17 | Agent 产出按 PR 标准对待：定向验证 + diff 审查 + 决策留痕 | MUST | OpenAI |

### 2.4 状态反馈（Status & Progress）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-18 | 等待指示分级：<1s 无需指示；1–3s 显示 spinner；>3s 显示描述性进度文本；>10s 必须有进度指示 + 可中断手段 | MUST | MS-Fluent2 Wait UX, NN/g |
| IA-19 | 状态文本命名公式 = **动作词 + 具体对象 + 限制/范围**（如"正在读取 src/auth/ 下 3 个文件"），禁止空洞的"正在思考…" | MUST | Vercel, OpenAI |
| IA-20 | 工具调用有明确的子状态机：Pending → Running → Completed / Error / Denied / AwaitingApproval，各状态视觉可区分 | MUST | Vercel AI Elements |
| IA-21 | 多步任务展示 Agent 的待办清单（todo list），该清单是用户监督与纠偏的交互锚点——用户可随时打断并修改计划 | MUST | Claude Code, OpenAI |
| IA-22 | 会话级状态机完备：ready / submitted / streaming / error；中断（abort）与断连（disconnect）是可区分的状态 | MUST | Vercel useChat |
| IA-23 | 持续显示上下文余量（如 "context left: 72%"）；接近上限时自动压缩并明确告知 | SHOULD | Codex, Claude Code, Gemini CLI |

### 2.5 上下文展示（Context Visibility）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-24 | 用户必须能看到"AI 当前知道什么"：纳入了哪些文件/片段/历史，以显式引用（如 @-mentions 或上下文面板）呈现 | MUST | Cursor, Claude Code, Sarkar'25 |
| IA-25 | 上下文可编辑：用户可增删上下文条目，变更后有可见反馈 | MUST | Cursor, Sarkar'25 |
| IA-26 | 自动附加的隐式上下文（当前文件、选区、终端输出等）必须显式列出，不得静默注入 | SHOULD | Cursor, GitHub |
| IA-27 | 上下文压缩/截断发生时，告知用户哪些信息被移除，并提供"压缩时保留什么"的定制入口 | SHOULD | Claude Code, Gemini CLI |

### 2.6 工具调用透明（Tool-Call Transparency）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-28 | 提供收敛/详细两级视图（compact/verbose）：默认显示工具名+状态，一键展开完整输入/输出与推理；视图偏好跨会话持久 | MUST | Claude Code |
| IA-29 | 联网搜索等外部动作在会话记录中显式标记，结果附可点击的来源链接 | MUST | OpenAI Codex, NN/g |
| IA-30 | 来源引用必须可点击、可验证，且明确警示"引用存在不等于内容正确"（防光环效应） | MUST | NN/g |

### 2.7 工件与双栏（Artifacts / Dual-Pane）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IA-31 | 当产出物是可迭代的内容（代码文件、文档、页面）时，提供独立于聊天流的工作区（双栏/工件面板），聊天用于讨论、面板用于编辑与渲染 | SHOULD | Anthropic Artifacts, OpenAI Canvas |
| IA-32 | 工件触发克制：对重度用户"宁可不触发，不可误触发"；触发行为可预测、可关闭 | MUST | OpenAI Canvas |
| IA-33 | 工件面板中的运行/渲染在隔离沙箱中执行，结果即时可见 | MUST | Anthropic Artifacts |

---

## 3. 交互流程规范

### 3.1 意图澄清（Clarification）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-01 | 用户意图存在实质歧义（多种合理解法且后果不同）时，先澄清再行动；无实质歧义时直接行动，不做仪式性确认 | MUST | MS-HAX G2, Anthropic |
| IF-02 | 澄清问题给出具体选项而非开放式追问，降低用户的表达成本（应对"表达障碍" articulation barrier） | SHOULD | NN/g |
| IF-03 | 禁止"魔法 8 号球"式应答：对无法完成的任务明确说明能力边界，不给模棱两可的敷衍答案 | MUST | NN/g, MS-HAX G3 |
| IF-04 | 新用户引导分阶段进行：首次会话展示核心能力 + 边界 + 一个可立即试的示例；不一次性倾倒全部功能 | SHOULD | Google-PAIR, MS-HAX G1 |

### 3.2 计划确认（Plan Approval）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-05 | 复杂任务（跨多文件/方法不确定/用户不熟悉代码）默认进入只读计划模式：可探索、不可写，产出书面计划 | MUST | Claude Code, Gemini CLI, Cursor, Anthropic |
| IF-06 | 计划批准界面提供分级选项：自动接受编辑 / 逐条人工审查 / 继续迭代计划 / 取消；批准动作同时确定后续权限档位 | MUST | Claude Code, Gemini CLI |
| IF-07 | 计划是可编辑工件（文件或编辑器视图），用户可直接修改计划文本 | MUST | Claude Code, Gemini CLI |
| IF-08 | 一句话能说清的小改动跳过计划流程 | SHOULD | Anthropic |

### 3.3 进度反馈与监督（Progress & Oversight）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-09 | 长任务全程展示待办清单 + 当前步骤状态（公式见 IA-19）；用户可随时打断纠偏 | MUST | Claude Code, OpenAI |
| IF-10 | 纠偏优先于重来：中断后保留上下文、立即接受新指令；同一问题纠偏超过两次，建议清空上下文用更精确的提示重来，且清空与回退入口同样易达 | SHOULD | Claude Code |
| IF-11 | Agent 自治执行设置步数/调用上限（如 20 次工具调用），触顶暂停并请示 | SHOULD | Windsurf |

### 3.4 错误处理（Error Handling）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-12 | 错误消息 = 什么失败 + 为什么 + 至少两条出路（重试/换方案/转人工） | MUST | MS-Fluent2 |
| IF-13 | Agent 自身犯错（事实错误、误解指令）时立即、具体承认并修正，不淡化 | MUST | OpenAI Model Spec |
| IF-14 | 技术失败映射为人类语言；保留技术细节在可展开的"详细信息"中 | MUST | MS-Fluent2, Lovable 实践 |
| IF-15 | 部分失败给部分结果：已完成的步骤保留并展示，不清空全部进展 | MUST | OpenAI ChatGPT agent |
| IF-16 | 分层降级：模型/工具不可用时降级到可用能力并明示降级事实 | SHOULD | Lovable 实践 |

### 3.5 人类接管（Human Takeover）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-17 | 提供四类控制手段并界面可达：**接管**（用户直接操作）、**确认**（关键动作前询问）、**任务边界**（Agent 能力声明）、**旁观模式**（只看不动） | MUST | OpenAI Operator |
| IF-18 | 中断键（Esc/停止）全局可用，中断后：停止生成 → 保留已输出内容 → 清理"运行中"状态 → 立即接受新指令（工程细则见 5.3） | MUST | Claude Code, OpenAI, Vercel |
| IF-19 | 用户接管操作后，Agent 不得自动"抢回"控制权；恢复 AI 操作需用户显式动作 | MUST | OpenAI Operator, MS-Copilot |

### 3.6 权限与安全（Permissions & Safety）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-20 | 权限模式 ≥4 级且持久可见（见 P5）；运行中可一键换挡 | MUST | Claude Code, Gemini CLI |
| IF-21 | 高风险动作（删除、迁移、密钥、支付、对外发布、安全敏感 API）在任何非完全自动模式下都需显式确认，且确认界面说明风险与后果 | MUST | CCS'23, FAccT'24, Claude Code |
| IF-22 | 自动审批（如有）必须由独立模型/分类器执行，输入剥离不可信内容（工具结果），防注入操纵；自动审批解析失败一律拒绝（fail closed）；连续阻断 N 次自动回退人工确认 | MUST | Claude Code, OpenAI Codex |
| IF-23 | 用户在对话中声明的边界（"别 push 到 main"）必须被系统强制执行，而非仅靠模型自觉 | MUST | Claude Code |
| IF-24 | 提供确定性钩子机制（如 PreToolUse hooks）：可对任意工具调用放行/拒绝/转人工/改写参数；钩子是"必须发生"的保障，提示词指令只是建议 | SHOULD | Claude Code |
| IF-25 | 权限模式可被组织管理员锁定（企业策略） | SHOULD | Claude Code, GitHub |

### 3.7 回滚与检查点（Checkpoints & Undo）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-26 | 每次用户输入或写操作前自动创建 checkpoint；一键回退到任一历史点（可选恢复代码/对话/两者） | MUST | Claude Code, Gemini CLI, Cursor |
| IF-27 | AI 变更原子提交；崩溃后无半截修改、无丢失工作 | MUST | Aider |
| IF-28 | 明确告知 checkpoint 边界（保留期、不追踪的副作用类型），引导里程碑处正式版本提交 | MUST | Claude Code |
| IF-29 | 会话默认持久化、可恢复、可命名，把会话当分支管理 | SHOULD | Claude Code, Codex, Gemini CLI |

### 3.8 可审计性（Auditability）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| IF-30 | 每个动作留证据链：提示 → 工具调用 → 权限决策（含决策来源：规则/用户/分类器）→ 结果 | MUST | Claude Code 安全实践, OpenAI |
| IF-31 | 会话记录完整可回放：哪个方案被采纳/拒绝及原因 | SHOULD | CHI'24, GitHub session logs |
| IF-32 | 支持结构化审计事件导出（如 OpenTelemetry），默认关闭、显式开启、默认脱敏用户输入 | COULD | OpenAI Codex |

---

## 4. 对话式编程的认知设计

### 4.1 不确定性表达（Expressing Uncertainty）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| CD-01 | 不确定时使用**第一人称**表述："我不太确定，但根据 X……"；避免第三人称泛化免责（"AI 有时会出错"）——实证表明前者更有效地校准信任 | MUST | NN/g |
| CD-02 | 置信度分 High / Medium / Low 三类表达；**禁止使用百分比**（"我有 73% 把握"制造假精确） | MUST | NN/g, OpenAI Model Spec |
| CD-03 | 低置信回答必须同时给出验证路径（"你可以通过运行 X 来确认"），把不确定性转化为可行动的检查 | MUST | NN/g, Anthropic |
| CD-04 | 禁止谄媚（sycophancy）：不因用户施压而改变对事实的判断；用户指出错误时先验证再承认，不无原则道歉后重复错误 | MUST | Anthropic Constitution, NN/g |
| CD-05 | AI 生成的解释/摘要自身标注"可能出错"并提供验证入口；解释内容不得与代码实际行为矛盾 | SHOULD | CHI'24 (Ivie) |

### 4.2 信任校准机制（Trust Calibration Infrastructure）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| CD-06 | 提供质量指示的客观依据：展示可验证证据（测试通过、构建成功、引用来源），而非语气自信 | MUST | FAccT'24, OpenAI |
| CD-07 | 防止虚假高效感：不以接受率作为价值展示信号；不通过流畅动画/速度感暗示输出质量 | MUST | METR'25, CACM'24, CCS'23 |
| CD-08 | 不确定度信号映射到行动：高亮"最可能需要审查/编辑的位置"；禁止以 token 生成概率作为置信提示（实证无效） | MUST | TOCHI'25 |
| CD-09 | 信任是情境性的：按任务风险分级呈现——高风险场景默认更强验证脚手架（逐块确认、解释优先、测试提示） | MUST | FAccT'24, CCS'23 |

### 4.3 控制权与主动权（Control & Initiative）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| CD-10 | 提供显式自治级别控制（仅建议 ↔ 审查后应用 ↔ 应用并自验），高风险任务自动降级到需审查档 | MUST | FAccT'24, Microsoft Research'25 |
| CD-11 | 主动（proactive）建议满足三约束：低打断成本（分层脚手架）、易驳回（与采纳等权重）、状态感知（用户输入中不弹建议） | MUST | CHI'25, CHI'24 |
| CD-12 | 换挡成本接近零：用户在 Ask/Edit/Agent（或等价档位）间切换不需要离开当前上下文 | SHOULD | GitHub, Cursor |

### 4.4 可预测性（Predictability）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| CD-13 | 相同输入产生可预期的行为路径；功能的触发条件稳定（触发克制的另一面是可预测） | MUST | OpenAI Canvas, MS-HAX G8 |
| CD-14 | 界面命名与状态文本遵循一致公式（见 IA-19）；禁止同一状态多种叫法 | MUST | Vercel |
| CD-15 | 能力边界可预先知晓：在交互前/初次交互时明确 Agent 能做什么、不能做什么 | MUST | MS-HAX G1/G2, Apple-HIG |

### 4.5 经验分层（Novice / Expert Asymmetry）

> 实证基础：同一默认行为对新手与专家的净效应可能相反——Copilot 对专家是 asset、对缺乏过滤能力的新手是 liability [JSS'23]；生成式 AI 放大而非消除元认知差距 [ICER'24]；新手易被错误建议带入调试兔子洞 [TOCHI'23]。

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| CD-16 | 检测到新手信号（高接受率+零编辑、反复全量生成请求、长时间无验证动作）时，主动插入验证脚手架：逐块确认、解释优先、测试提示 | SHOULD | TOCHI'23, JSS'23, ICER'24 |
| CD-17 | 专家信号（高频编辑 diff、使用快捷键、自定义配置）下降低摩擦：更少的确认、更快的路径 | SHOULD | ICSE'24, CACM'24 |
| CD-18 | 建议密度与粒度可调；用户连续忽略/删除建议时自动降级粒度 | SHOULD | TOCHI'23, ICSE'24 |

### 4.6 心智模型与动机对齐（Mental Model Alignment）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| CD-19 | 为真实动机设计：开发者使用 AI 的首要动机是减少击键、快速完成、回忆语法——交互以"最小认知努力"为目标，不为头脑风暴等功能过度设计 | SHOULD | ICSE'24 (410 人调查) |
| CD-20 | 幻觉不是 bug 而是特性：界面设计必须假设任何输出都可能错误，把"验证脚手架"作为默认组成部分而非异常处理 | MUST | NN/g |
| CD-21 | 管理期望：明确传达 AI 的适用场景与不适用场景，防止"AI 总会生成正确代码"的错误心智模型 | MUST | Apple-HIG, TOCHI'23 |

---

## 5. 工程实现规范（界面开发者适用）

### 5.1 流式状态机（Streaming State Machine）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| EN-01 | 会话状态机至少包含：`ready` / `submitted` / `streaming` / `error`；记录 `finishReason`（stop / length / tool-calls / error / abort）以区分正常结束与异常结束 | MUST | Vercel AI SDK |
| EN-02 | 中断（`isAbort`）与断连（`isDisconnect`）必须区分处理：前者是用户主动行为（静默收尾），后者需要恢复/重试路径 | MUST | Vercel |
| EN-03 | 工具调用子状态机：`Pending → Running → Completed / Error / Denied / AwaitingApproval`，驱动独立 UI 组件 | MUST | Vercel AI Elements |

### 5.2 渲染性能（Rendering Performance）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| EN-04 | 流式更新经节流（约 50ms）+ `requestAnimationFrame` 批量提交 DOM，避免每 token 触发重渲染 | MUST | Vercel |
| EN-05 | 代码块语法高亮延迟/防抖 200–300ms 执行；长消息列表虚拟化 | MUST | Vercel |
| EN-06 | 流式期间仅对进行中的块做降级渲染（见 IA-04），不重排已完成内容 | MUST | Vercel |

### 5.3 中断清理（Interrupt Cleanup）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| EN-07 | 中断处理四步：(1) 中止网络流；(2) 保留已输出内容为正式消息（标记"已中断"）；(3) 将所有"运行中"的工具调用/状态指示收尾为终止态；(4) 恢复输入区可用。禁止遗留 spinner 或半截"正在输入" | MUST | Vercel |

### 5.4 可访问性（Accessibility）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| EN-08 | 消息流 a11y 配置见 IA-01；动态状态文本（进度/工具状态）使用独立的 `aria-live` 区域且通知防抖 | MUST | Vercel, WAI-ARIA |
| EN-09 | 尊重 `prefers-reduced-motion`：降级光标动画、打字机效果与过渡动画 | MUST | Vercel, WCAG |
| EN-10 | 所有关键操作（接受/拒绝 diff、中断、批准）可纯键盘完成 | MUST | WCAG, 行业实践 |

### 5.5 消息编辑与分支（Edit & Branch）

| 编号 | 规则 | 强度 | 来源 |
|---|---|---|---|
| EN-11 | 编辑历史消息 = 更新消息列表 + 截断后续 + 重新生成；保留被截断分支可切换回看 | SHOULD | Vercel (setMessages / MessageBranch) |

---

## 6. Agent 可执行检查清单（可直接作为系统提示词片段）

> 以下清单供构建 AI Coding 助手时核对，亦可摘取为 Agent 运行时的行为约束。✅ = 上线前必须全部满足。

### 6.1 行为约束（Agent 运行时自查）

```
【生成前】
□ 我是否理解了真实意图？存在实质歧义 → 先澄清（给出具体选项）
□ 任务是否复杂（跨多文件/方法不确定）？是 → 先进入只读计划模式，产出可编辑计划并等待批准
□ 我当前处于用户授权的哪个自治档位？即将执行的动作是否超出该档位？超出 → 先请求授权

【生成中】
□ 每一步工具调用是否有可见状态条目（工具名+状态）？
□ 状态文本是否遵循「动作词+具体对象+范围」公式？
□ 我是否在展示待办清单，让用户可以监督纠偏？
□ 用户中断了？→ 立即停下、保留已输出内容、收尾运行中状态、等待新指令

【生成后】
□ 是否附带了变更摘要（改了什么、为什么、涉及哪些文件/符号）？
□ 写操作是否以可审查的 diff 呈现（带意图说明）？
□ 声明完成时是否附上了证据（测试输出/命令结果/截图），而非仅断言成功？
□ 验证入口（运行/测试/diff）是否比重新生成更容易触达？
□ 不确定的地方是否用第一人称表达（"我不太确定…"）并给出验证路径？
□ 是否使用了百分比置信度？→ 改为 High/Med/Low
□ 是否有谄媚表述？用户纠错时是否先验证再承认？
□ 引用来源是否可点击验证？

【安全红线（任何情况下不可违反）】
□ 高风险动作（删除/迁移/密钥/对外发布/安全敏感 API）是否已获显式确认并说明风险？
□ 受保护路径（.git、自身配置、shell rc）是否绝不自动批准？
□ 用户在对话中声明的边界（如"别 push 到 main"）是否被强制执行？
□ 每个动作是否留有证据链（提示→调用→权限决策→结果）？
□ 写操作前是否已创建 checkpoint，用户可一键回退？
```

### 6.2 界面验收清单（产品上线前）

```
【消息流】
□ 滚动自主权：用户上翻后流式输出不强制吸底，有"回到底部"按钮
□ role="log" + aria-live="polite"，屏幕阅读器通知有防抖
□ Markdown 流式降级渲染仅作用于进行中块
□ prefers-reduced-motion 生效

【代码与 Diff】
□ 代码块：语言标签+一键复制+（多文件时）路径标识
□ 语法高亮防抖 200–300ms
□ 所有写操作可 diff 审查，支持逐块接受/拒绝
□ 解释就地锚定在代码旁，不需跳面板

【状态与进度】
□ <1s 无指示 / 1–3s spinner / >3s 描述文本 / >10s 进度+可中断
□ 工具调用子状态（Pending/Running/Completed/Error/Denied/AwaitingApproval）视觉可区分
□ 上下文余量可见，压缩发生时告知用户
□ 中断后无遗留 spinner、无半截"运行中"

【权限与回滚】
□ ≥4 级权限模式，状态栏持久可见，运行中可切换
□ 读放行/写确认为默认基线
□ 每 prompt 或写操作前自动 checkpoint，可一键回退（代码/对话/两者）
□ 会话持久化、可恢复、可命名

【信任校准】
□ 无百分比置信度；无谄媚；错误立即具体承认
□ 主动建议：分层脚手架 + 采纳/驳回等权重 + 用户输入中不弹
□ AI 身份标识持久可见；无拟人化伪装
□ 错误消息 = 什么失败+为什么+两条出路
```

---

## 7. 来源清单

### 7.1 公司与平台官方规范/文档

| 组织 | 来源 | 主要贡献 |
|---|---|---|
| **Anthropic** | Building Effective Agents（工程博客）；Claude Code Best Practices；Claude Code 官方文档（permission modes / hooks / checkpoints）；Claude's Constitution；Artifacts 设计 | 简单性、透明 ACI、verification loop、plan mode、权限模式、checkpoint/rewind、渐进式披露、校准不确定性、反谄媚 |
| **OpenAI** | Latency optimization 指南；Model Spec；Canvas 设计；Codex 文档（Agent approvals & security / CLI features）；ChatGPT agent / Operator 控制体系 | 流式优先、show your steps、Canvas 触发克制、sandbox+approval 双旋钮、evidence-not-assertion、Operator 4 控制、不确定性语言、立即认错 |
| **Microsoft** | HAX Guidelines for Human-AI Interaction（Amershi et al., CHI 2019，G1–G18）；Copilot UX 指南；Fluent 2 Responsible AI + Wait UX | 18 条人机交互准则、人类掌控、反拟人化、等待分级 UX、错误消息三段式 |
| **Google** | PAIR People + AI Guidebook（6 章）；Gemini CLI 文档（plan mode / checkpointing / chat compression）；Gemini 视觉设计 | 自动化 vs 增强框架、校准信任、分阶段引导、优雅失败、计划模式、检查点 |
| **GitHub** | Copilot 信任设计文档；Copilot 研究（CACM 67(3)）；Agent 模式权限分层 | 信任 by design、发起者≠批准者、Ask/Edit/Agent 控制梯度、session logs、30% 接受率基线、接受率的局限 |
| **Cursor / Windsurf / Zed** | 官方文档与博客 | 人类驾驶座、Shadow Workspace、Plan Mode、可编辑 unified diff、@-mentions、checkpoints、执行上限、subtle mode |
| **Vercel** | AI SDK useChat 文档；AI Elements 组件库 | 流式状态机、工具调用子状态、滚动自主权、rAF 批渲染、中断清理、a11y 配置 |
| **Apple** | Human Interface Guidelines – Generative AI | 透明包含、期望管理、用户控制、AI 协助明示 |
| **IBM** | Carbon for AI 设计体系 | AI label、分层透明、工作流内可解释性 |

### 7.2 学术与研究机构

| 来源 | 关键发现 |
|---|---|
| Mozannar et al., **CHI 2024**（Microsoft Research, CUPS 分类法） | 验证建议占会话时间 22.4%（最高单项）；延迟验证积累"验证债"（事后编辑率 0.53 vs 0.18）；prompt crafting 期间建议接受率仅 10.7% |
| Becker et al., **METR 2025**（RCT） | 资深开发者用 AI 实际慢 19%，但自认快 20%——感知与实际严重背离 |
| Perry et al., **ACM CCS 2023**（Stanford） | AI 助手使用者写出更不安全代码且更自信——自动化偏差实证 |
| Vasconcelos et al., **TOCHI 2025** | "预测编辑位置"高亮有效；"生成概率"高亮无效 |
| Wang et al., **FAccT 2024** | 信任是情境性的；工具缺乏信任校准 affordance |
| Barke et al., **OOPSLA 2023** | 交互双峰：加速模式 vs 探索模式 |
| Chen et al., **CHI 2025** | 主动助手设计对：高效评估（分层脚手架）+ 高效利用（一键采纳/驳回） |
| Yan et al., **CHI 2024**（Ivie） | 解释就地锚定五原则：锚定、轻量、易唤起、易消失、随时可召回 |
| Ziegler et al., **CACM 2024**（GitHub 官方研究） | 接受率是感知生产力最强预测因子，但会被"未验证即接受"虚增 |
| Liang, Yang, Myers, **ICSE 2024** | 410 人调查：首要动机=减少击键/快速完成/回忆语法；最小认知努力设计 |
| Prather et al., **TOCHI 2023 / ICER 2024** | 新手 shepherding/straying 模式；GenAI 扩大元认知差距 |
| Moradi Dakhel et al., **JSS 2023** | Copilot 对专家是 asset、对新手是 liability |
| Sarkar & Drosos, **PPIG 2025**；Fakhoury et al., **2025** | Vibe coding 实证：信任细粒度动态有条件；专业知识转向上下文管理与快速评估 |
| **Nielsen Norman Group** | 意图式结果指定范式、表达障碍、第一人称不确定性、High/Med/Low 置信类别、光环效应、响应时间阈值（0.1s/1s/10s）、反谄媚 |
| **Aider**（官方文档） | Git-native：每次编辑即 commit、diff 展示、/undo；崩溃恢复设计 |

### 7.3 研究过程文件

本规范的研究过程文件（10 个维度研究 + 交叉验证）位于 `/mnt/agents/output/research/`：
`ai_coding_design_dim01.md`（Anthropic）至 `dim10.md`（终端 Agent 工具），以及 `ai_coding_design_synthesis.md`（交叉验证与洞察提炼）。

---

*本规范为 v1.0，基于 2026 年 8 月前公开的一手资料。AI 交互设计是快速演进领域，建议每 6 个月依据新证据复审本文件。*
