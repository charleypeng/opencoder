# 变更记录

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- Tauri 2 + SolidJS 工程脚手架，devtools 仅限 debug 构建启用 (TASK-M0-01)
- 设计令牌与 Tailwind CSS v4 基座，支持深浅色主题切换 (TASK-M0-02)
- OpenAPI 类型生成管线：`openapi-typescript` 从版本锁定契约生成类型，带漂移检测 (TASK-M0-03)
- Mock OpenCode Server REST 骨架：健康检查 / 项目 / 会话端点、故障注入、可选 Basic Auth (TASK-M0-04)
- Mock Server SSE 流与场景脚本：happy-chat、permission-flow、question-flow、sse-drop (TASK-M0-05)
- 真实响应样本 fixtures，含录制脚本与 schema 校验 (TASK-M0-06)
- CI 流水线与 `pnpm verify` 质量门禁，husky + lint-staged 提交前钩子 (TASK-M0-07)
- 双语工程文档骨架：README / CHANGELOG（中英）+ CONTRIBUTING (TASK-M0-08)
- Rust REST 传输通道（reqwest/rustls、Basic Auth、超时、取消、错误分类）与 TS ApiClient 门面（invoke/fetch 双传输实现）(TASK-M1-01)
- Rust SSE 订阅管理器（跨 chunk 逐行解析、`tui.*`/`workspace.*` 事件过滤、16ms 批刷 Channel 推送、指数退避重连、心跳判死）与 TS 订阅门面（tauri Channel 封装）(TASK-M1-02)
- Rust 服务器注册表：持久化 CRUD commands（`list_servers`、`add_server`、`update_server`、`remove_server`、`resolve_server_base_url`），基于 tauri-plugin-store，带 `servers-changed` 同步事件；传输通道改为经由注册表解析服务器地址 (TASK-M1-03)
- Rust 健康监控器：每服务器独立 15s `GET /global/health` 轮询（复用 REST 传输层），记录延迟与版本，连续 3 次失败判定 down 并支持恢复，状态变化经 `server-health` 事件推送前端；新增 SolidJS 连接 store 同步健康快照 (TASK-M1-04)
- 添加服务器向导：名称/URL/可选认证表单，URL 规范化、实时「测试连接」探测（显示版本/延迟）、明文 HTTP 风险提示，保存走注册表 commands；并为注册表 commands 新增类型化 TS 封装 (TASK-M1-05)
- 服务器导航首页：App 启动落点，响应式服务器卡片网格（名称/URL/状态灯/版本/延迟/最近连接），经 `servers-changed` 与 `server-health` 事件实时更新；卡片右键菜单（含菜单按钮）提供编辑/重连/删除（二次确认）；添加服务器向导支持编辑模式（`update_server`）；空状态引导页 (TASK-M1-06)
- mDNS 局域网自动发现：Rust 扫描 `_opencode._tcp`（及 `opencode serve --mdns` 发布的 `_http._tcp` 广播），按实例去重并 emit `server-discovered` 事件，提供幂等的 `start_mdns_discovery` / `stop_mdns_discovery` / `get_discovered_servers` commands，局域网不可达时静默降级；添加服务器向导新增「附近的服务器」区块，支持一键填充与自动探测 (TASK-M1-07)
- 服务器工作区壳：三栏桌面骨架（服务器图标 Rail 含每服务器健康状态点与 ⌘/Ctrl+1..9 快速切换、侧栏、主区）替换占位视图；新增激活服务器 registry store 为各 per-server store 注入上下文（切换不串数据）；离开时预留 SSE 断开挂载点（M2 接入）；移动端壳占位（M7）(TASK-M1-08)
- 凭证重认证与连接错误处理：分类错误文案（`errorTitle`/`errorDetail`）集中在 `services/errors.ts`（401/网络不可达/超时/5xx/非法 URL/已取消/响应格式异常）；ServerHome 加载与重连失败使用可关闭的 `ErrorBanner`；401 触发凭证重输对话框，新凭证先经探测验证通过后才持久化（`update_server`）；TS 侧探测响应校验将非健康负载判定为 `invalid_response`（TASK-M1-09）
- 项目/会话/消息领域服务层：基于 ApiClient 的工厂形态类型化服务（`createProjectService` / `createSessionService` / `createMessageService`），覆盖 `/project`、`/project/current`、`/path`、会话 CRUD（`/session` GET/POST、`/session/{id}` GET/PATCH/DELETE）、`/session/status`、带 `limit`/`before` 分页的消息历史（`/session/{id}/message`）、`prompt_async` 与 `abort`；类型全部取自 schema，错误按 ApiError 透传；mock server 新增 `/path`、`/session/status`、创建/更新/删除、`prompt_async`（204）、`abort` 与支持 `limit` 的消息分页，并实现跨 fixture 根目录的 fixture 回退（TASK-M2-01）
- SSE 事件路由与归一化 store：per-server 会话 store（列表/顺序/状态/当前会话 id）、消息归一化 store（`parts: Record<id, Part>` + `order`，delta 追加 O(1)，delta 先于 part 到达时建 text stub，part/消息删除）、项目 store（项目列表 + 当前目录），以及 `events.ts` 路由表将 `session.*` / `message.*` / `message.part.*` 事件分发进各 store；`server.connected` 经 `subscribeToServerEvents` 触发 `syncAll` 全量对齐（会话列表 + 状态表 + 项目列表 + 当前目录）；L1 测试直接驱动 mock happy-chat 场景断言最终 store 状态（TASK-M2-02）
- 项目/文件夹切换器：Sidebar 上段下拉组件（项目名 + 路径、当前项高亮、每服务器「最近项目」localStorage 记忆，上限 5 条），数据来自 `/project` + `/project/current`；切换项目即切换全局 `?directory=` 上下文（显式 per-call directory 现在优先于全局值），DesktopShell 重建该目录的 SSE 订阅（先退订旧流、再订阅新目录并全量对齐，切换前清空会话/消息状态保证跨目录互不串扰），新增 `project.updated` / `project.directories.updated` 项目列表刷新路由；mock server 扩展为双项目 fixture（`/session` 与 `/project/current` 按目录返回隔离数据，新增 labs 会话列表）（TASK-M2-03）
- 会话列表与状态徽标：Sidebar 下段按本地时间分组（今天/昨天/本周/更早，周一为周起始，跨 DST 安全）渲染会话，每条会话带状态徽标（busy/retry 转圈、idle 圆点、错误红点含 message 提示），由 SSE 驱动 store 实时更新；本地大小写不敏感搜索过滤（按标题/slug，含无结果与空列表空态）、当前会话高亮、行选择接线（`setActiveSession` + 回调）、hover 操作占位「⋯」按钮（改名/删除由 M2-05 接线）与虚拟滚动准备注释；DesktopShell 在侧栏挂载会话列表，主区占位改为回显所选会话 id（聊天视图 M2-06/08 落地）（TASK-M2-04）
- 会话创建/改名/删除：「+ New session」按钮（侧栏头部 + 空态）经 `POST /session` 创建空会话并直接打开；行级操作菜单替换 M2-04 占位按钮，提供改名（预填对话框，Enter 提交 / Esc 取消，`PATCH /session/{id}`）与删除（二次确认对话框，`DELETE /session/{id}`）；三类变更均先落 store（乐观更新），失败时回滚到捕获的原值并在对话框内联/横幅展示错误；DesktopShell 主区占位改为由 store 的当前会话 id 驱动（TASK-M2-05）
- 消息历史渲染（初版）：主区聊天转录（`src/features/messages/`）在挂载/切换会话时拉取 `GET /session/{id}/message` 历史并合并进归一化消息 store（新增按消息 id 的 `infos: Record<id, Message>`，保留原单条 info 槽位兼容旧逻辑），用户气泡右对齐加 accent 底色、助手气泡左对齐，附 hh:mm 时间戳；Part 经 `TextPart`（纯文本保留空白与换行）、`ReasoningPart`（默认折叠，带预览与箭头展开）与 `ToolPart`（v1 卡片：工具名 + pending/running/completed/error 状态图标与文案，展开可见 JSON 美化后的 input 与原始 output/error）渲染；未支持的类型静默跳过；含加载/空态/内联错误 + 重试状态，流式 part 先于消息 info 到达时按助手角色兜底渲染，以及自动滚动（贴近底部时跟随、上翻暂停并显示「New messages」跳转按钮）；DesktopShell 为当前会话挂载消息列表（无会话时保留占位）（TASK-M2-06）
- Markdown 渲染与代码高亮：文本 Part 经 markdown-it 管线渲染（GFM：表格、删除线、任务列表、linkify、typographer），禁用原始 HTML 并将外链改写为新窗口打开（`target="_blank"` + `rel="noopener noreferrer"`），随后再过一层 DOMPurify（allowlist 扩展以放行 Shiki 内联样式、任务列表复选框与链接 target）；围栏代码块经懒加载的 Shiki 单例异步高亮（预载常用语言、其他内置语言包按需 `loadLanguage` 加载、任一步失败回退为纯转义 `<pre>`），每块代码带语言标签与复制按钮（Clipboard API + `execCommand` 回退，点击显示「Copied!」反馈）；基于设计令牌补齐 markdown 正文样式（标题/表格/任务列表/引用/行内代码/代码围栏）；安全用例覆盖双层消毒下的 script/onerror/javascript:/data: 注入以及复杂 markdown fixture 渲染（TASK-M2-07）
- 消息输入与异步发送：主区消息列表下方固定输入框（`src/features/sessions/PromptBox.tsx`），自适应高度 textarea（上限约 10 行）、⌘/Ctrl+Enter 发送（裸 Enter 只换行）、空输入 ↑ 召回并循环浏览每服务器 prompt 历史（内存态，上限 20 条，最近优先，↓/Esc 回退）；发送时先乐观插入本地用户消息（`local-*` 本地 id，会话 agent/model 字段映射为消息 schema 形态）并立即清空输入框，`POST /session/{id}/prompt_async` 失败时回滚乐观消息并展示内联错误横幅；POST 进行中锁定发送，store 状态 busy/retry 时锁定输入（占位符「Generating…」+ 顶部细进度条；Esc 中断由 M2-10 接线）；附件按钮为禁用占位（M3 接线）；DesktopShell 为当前会话挂载输入框；L2 测试覆盖发送/键盘/历史/锁定/失败流程，并含全链路用例（乐观发送后驱动 happy-chat SSE 场景，断言最终渲染包含用户消息与助手回复；E2E E03 随 M10 基建落地）（TASK-M2-08）
- 流式增量渲染管线：消息 store 新增 `messageParts` 分组映射（消息 id -> 有序 part id 列表，仅在 part 成员变化时整体替换）与每会话 `lastDeltaAt` 流式时间戳，并提供 `applyMessageBatch` 将整段历史载荷在一次 produce 内落地；转录列表改用手写虚拟列表（`createVirtualList`：固定估算高度 + 实测高度，ResizeObserver 感知流式行增高，带 overscan 与 `scrollToIndex`），长对话只挂载可见区间的行；每条消息抽成独立 `MessageBubble` 组件只订阅自身 info/parts，delta 到来时仅重渲染对应 part 行（消除 M2-06 每个 delta 全量重新分组渲染）；新增呼吸式打字光标（`TypingCursor`，追加在流式消息最后一个已渲染 token 的行内），由 `useStreamingIndicator`（busy 状态 + 5 秒 delta 窗口 + 1s 滴答定时器）驱动；会话生成期间聊天区顶部显示 2px 细进度条（删除 M2-08 PromptBox 自带进度条，统一以会话 busy 为唯一信号）；自动滚动跟随/暂停/跳转逻辑在虚拟列表之上保持可用；L1 测试覆盖分组不变性（文本 delta 不触碰 `messageParts`）、批量应用正确性/对账与 `lastDeltaAt`，含 1000-delta 性能基准；L2 覆盖气泡级细粒度重渲染（兄弟 part DOM 节点保持不变）、虚拟化行数、进度条与光标生命周期（fake timers）；性能基准套件（`perf.bench.test.tsx`）约束虚拟列表（1000 行 x 1000 次滚动定位）、300 条消息转录渲染与单 token delta 成本（TASK-M2-09）
- 中断生成与错误处理：会话生成中（busy/retry 状态）输入框的 Send 按钮替换为 Stop 按钮（方形危险图标，本地在途锁防止双击重复），点击即 `POST /session/{id}/abort`；Esc 经 window 级监听在任意焦点位置触发相同中断（生成时 textarea 被禁用，无法自行接收按键）；abort 失败以内联横幅呈现，服务端 `session.status` idle 事件到达后恢复 Send 按钮（store 驱动的输入自动恢复）；`session.error` 事件渲染为消息列表与输入框之间的可关闭横幅（`SessionErrorBanner`）：标题使用分类文案（`errorTitle`/`errorDetail` 新增限流分类——状态 429 或消息含 "rate limit"/"429" 提示 → "Rate limited — try again shortly"），原始消息置于可展开的「Show details」区；含 Retry 按钮，经共享 `sendPrompt` 管线（自 PromptBox 提取，输入框与横幅共用）重发该服务器 prompt 历史中的最后一条（重发失败以分类错误重挂横幅，成功则关闭）；横幅由 store 状态条目派生，任何替换状态（idle/busy）到达即自动隐藏；session store 新增 `dismissSessionError` 动作将 error 状态回退为 idle；L2 测试覆盖停止/Esc/abort 失败/idle 恢复、横幅渲染/关闭/自动隐藏/重试（含防双击重试）与限流文案，L1 测试覆盖 `dismissSessionError`、`getLastPrompt` 与 sendPrompt 管线（E2E E04 随 M10 基建落地）（TASK-M2-10）
