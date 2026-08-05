# API 覆盖规划（162 端点 → 功能域 → 优先级）

> 契约基准：`docs/openapi_v1.18.11.json`（OpenAPI 3.1，opencode v1.18.11）
> 优先级：**P0** 核心闭环 → **P1** 主流程增强 → **P2** 效率工具 → **P3** 高级能力 → **P4** 管理配置 → **Backlog**（实验/非客户端场景）

## 0. 双 API 面说明

| API 面 | 端点数 | 特征 | 策略 |
|---|---|---|---|
| 稳定面（`/session`、`/file`、`/event`…） | ~90 | 官方 TUI/Web 客户端使用，行为稳定 | **v1.0 主实现基线** |
| V2 面（`/api/*`） | 51 | 需鉴权（401），事件粒度更细（`SessionNextTextDelta` 等原生事件），独有 integration/credential/fs/permission-saved 能力 | 服务层抽象兼容；独有能力按需接入（见下表标注 ★） |
| 实验面（`/experimental/*`） | 21 | workspace/worktree/sync/console | **Backlog**，API 稳定后再评估 |

## 1. P0 — 核心闭环（M1–M2）

| 端点 | 用途 | 里程碑 |
|---|---|---|
| `GET /global/health` | 健康检查 + 版本探测（多服务器管理基石） | M1 |
| `GET /global/event` | 全局 SSE（跨目录事件） | M1 |
| `GET /event` | 目录级 SSE（聊天流式渲染的生命线） | M2 |
| `GET /project` / `GET /project/current` | 项目（文件夹）列表与当前项目 | M2 |
| `GET /path` | 当前目录信息 | M2 |
| `GET /session` / `POST /session` | 会话列表/创建 | M2 |
| `GET /session/{id}` / `PATCH` / `DELETE` | 会话详情/改名/删除 | M2 |
| `GET /session/status` | 全部会话运行状态（忙碌/空闲/重试） | M2 |
| `GET /session/{id}/message` | 消息历史（分页 `limit`/`before`；`limit` 无游标时返回最近一页，`before` 为消息 id 游标、仅返回更早消息，未知 id 返回空数组） | M2（M3-05 分页语义） |
| `POST /session/{id}/prompt_async` | 发送消息（异步，配合 SSE 流式渲染） | M2 |
| `POST /session/{id}/abort` | 中断生成 | M2 |

## 2. P1 — 主流程增强（M3、M5）

| 端点 | 用途 | 里程碑 |
|---|---|---|
| `GET /agent` | agent 列表（build/plan 等模式切换） | M5 |
| `GET /provider` / `GET /config/providers` | provider/模型列表与默认模型 | M5 |
| `GET /command` | 斜杠命令列表 | M5 |
| `POST /session/{id}/command` | 执行斜杠命令 | M5 |
| `GET /skill` | 服务端 skills 列表（`@` 引用候选；隐藏技能由服务端过滤，1.18.11 契约无 hidden 字段） | M5 |
| `POST /session/{id}/shell` | 会话内执行 shell 命令（`!` 前缀；同步返回 `{ info, parts }` 消息） | M5 |
| `GET /permission` / `POST /permission/{requestID}/reply` | 权限请求队列与应答（remember 记忆） | M5 |
| `GET /question` / `POST /question/{id}/reply` / `…/reject` | Agent 提问卡片与回答/拒绝 | M5 |
| `GET /session/{id}/todo` | Todo 面板（实时任务清单） | M3 |
| `GET /session/{id}/message/{messageID}` | 单条消息详情 | M3 |
| `DELETE /session/{id}/message/{messageID}` | 删除消息 | M3 |
| `PATCH,DELETE /session/{id}/message/{mid}/part/{partID}` | 编辑/删除消息 Part（重问的基础） | M3 |

> Skill 引用与 shell 说明（TASK-M5-08）：`@` 菜单的 skills 分组插入纯文本
> `@skillName` 引用（与 `@path` 文件引用一致）——服务端在回显消息中把
> `@name` 提及解析为 `AgentPartInput` part（契约的 `source { value, start, end }`
> 即文本跨度），客户端不做 part 映射。`!` 前缀走 `POST /session/{id}/shell`
>（body `{ command, agent, model? }`，`agent` 为契约必填），同步返回创建的
> assistant 消息 `{ info, parts }` 直接写入消息 store（无 SSE 回显）；`!`
> 条目不记入提示历史。

## 3. P2 — 效率工具（M4）

| 端点 | 用途 | 里程碑 |
|---|---|---|
| `GET /file?path=` | 文件树 | M4 |
| `GET /file/content?path=` | 文件查看（含 diff/patch/encoding/mimeType） | M4 |
| `GET /file/status` | 已跟踪文件状态（git 变更标记） | M4 |
| `GET /find?pattern=` | 全文搜索 | M4 |
| `GET /find/file?query=` | 模糊找文件（⌘P 快速打开） | M4 |
| `GET /find/symbol?query=` | 符号搜索 | M4 |
| `GET /session/{id}/diff` | 会话/消息级 diff 视图 | M4 |

> `GET /find` 正则说明（TASK-M4-05）：1.18.11 契约仅暴露 `pattern`（无正则开关）。
> 搜索面板的正则模式额外发送 `regex=true` 查询参数 —— 该参数为 Mock Server
> 扩展（fixture 匹配按正则解释），**真实服务端会忽略它并按字面匹配**；客户端在
> 正则模式下仍会在请求前校验模式合法性（非法模式不请求、提示错误）。
| `GET /vcs` / `GET /vcs/status` | 分支与变更概览 | M4 |
| `GET /vcs/diff` / `GET /vcs/diff/raw` | 工作区 diff | M4 |
| `POST /vcs/apply` | 应用 patch | M4 |
| `GET /api/fs/find` / `GET /api/fs/list` / `GET /api/fs/read/*` ★ | V2 文件能力（视与稳定面差异补充） | M4 |

## 4. P3 — 高级能力（M6）

| 端点 | 用途 | 里程碑 |
|---|---|---|
| `GET,POST /pty` / `GET,PUT,DELETE /pty/{id}` | 终端会话管理 | M6 |
| `GET /pty/{id}/connect` | 终端 WebSocket 数据通道（xterm.js） | M6 |
| `POST /pty/{id}/connect-token` | 终端连接令牌 | M6 |
| `GET /pty/shells` | 可用 shell 列表 | M6 |
| `POST /session/{id}/fork` | 从任意消息分叉会话 | M6 |
| `POST /session/{id}/revert` / `POST /session/{id}/unrevert` | 回滚/恢复（含文件变更） | M6 |
| `POST,DELETE /session/{id}/share` | 分享/取消分享链接 | M6 |
| `POST /session/{id}/summarize` | 会话摘要压缩 | M6 |
| `POST /session/{id}/init` | 生成 AGENTS.md | M6 |
| `GET /session/{id}/children` | 子会话树（subagent 任务可视化） | M6 |
| `POST /session/{id}/message` | 同步发消息（等待完整响应，供简单场景/脚本化） | M6 |

> `GET /pty/{id}/connect` 说明（TASK-M6-01）：1.18.11 契约将该端点文档化为普通
> HTTP（200 返回 JSON boolean），**未记录 WebSocket 子协议/帧格式**；真实服务端
> 实为 WebSocket 升级端点，认证走 `POST /pty/{id}/connect-token` 的 `ticket`
> query（字段名 ticket 而非 token），resize 走 REST `PUT /pty/{id}`（契约确认）。
> 契约级验证结论见 `docs/tasks/M6.md` 附录（contract-based，待真实服务端确认）。
> Mock 中该端点返回 **426 Upgrade Required** + JSON 说明（express 无法原生 WS
> 升级），WS 数据通道由独立 `tests/mock-server/ws-echo.mjs` 模拟（L3 契约测试）。

## 5. P4 — 管理与配置（M5、M9）

| 端点 | 用途 | 里程碑 |
|---|---|---|
| `PUT,DELETE /auth/{providerID}` | Provider API Key 管理 | M5 |
| `GET /provider/auth` | Provider 认证方式查询 | M5 |
| `POST /provider/{id}/oauth/authorize` / `…/callback` | OAuth 授权流（外部浏览器 + 回调） | M5 |
| `GET /config` / `PATCH /config` | 项目级配置查看/修改 | M9 |
| `GET,PATCH /global/config` | 全局配置 | M9 |
| `GET /mcp` / `POST /mcp` | MCP 服务器状态/动态添加 | M9 |
| `POST /mcp/{name}/connect` / `…/disconnect` | MCP 连接控制 | M9 |
| `POST,DELETE /mcp/{name}/auth` + `…/authenticate` / `…/callback` | MCP OAuth | M9 |
| `GET /lsp` / `GET /formatter` | LSP/格式化器状态（状态栏展示） | M9 |
| `POST /log` | 前端日志回传服务端 | M9 |
| `POST /instance/dispose` / `POST /global/dispose` | 实例释放 | M9 |
| `POST /global/upgrade` | 服务端自升级触发（谨慎，仅桌面显示入口） | M9 |
| `GET /api/permission/saved` / `DELETE /api/permission/saved/{id}` ★ | 已保存权限规则管理 | M9 |
| `GET /api/agent` / `GET /api/command` / `GET /api/model` / `GET /api/skill` ★ | V2 只读目录（与稳定面比对后选用） | M9 |

> OAuth 自动流说明（TASK-M5-07）：1.18.11 契约无授权状态查询端点，`auto`
> 模式客户端以 2s 间隔轮询 `POST /provider/{id}/oauth/callback`，body 携带
> `poll: true` —— 为 Mock Server 扩展（契约的 callback body `additionalProperties: false`，
> 真实服务端会忽略/拒绝该字段，自动流真实完成靠服务端本地回调监听器）；轮询在
> 授权完成时返回 `true`（最长 60s 超时）。Mock 中 `GET /oauth/authorize?state=`
> 页面模拟浏览器往返（访问即置完成），`code` 模式校验固定码 `mock-oauth-code`。
>
> MCP OAuth（TASK-M9-06）沿用同一模式：`POST /mcp/{name}/auth` 返回
> `{ authorizationUrl, oauthState }`，客户端打开浏览器后轮询
> `POST /mcp/{name}/auth/authenticate?poll=1`（契约该端点无请求体，`poll` 以
> **query 扩展**传递，真实服务端忽略未知 query）——Mock 中该端点为非阻塞
> 实现：浏览器尚未访问授权页时返回 `needs_auth`，访问后返回 `connected`
> （并持久化状态）；授权页为 Mock 扩展 `GET /mcp/oauth/authorize?state=`。
> `code` 模式提交 `POST /mcp/{name}/auth/callback`（body `{ code }`），
> 校验固定码 `mock-oauth-code`。契约 MCPStatus 仅含状态/错误字段（无 tools
> 计数），`mcp.tools.changed` 事件仅携带 server 名 → 客户端据此刷新列表。
> 契约无 `DELETE /mcp/{name}`，服务器删除不在本期 UI 范围。
>
> 状态栏与诊断（TASK-M9-07）：`EventLspUpdated` 的 properties 为空对象——
> `lsp.updated` 事件不携带数据，客户端仅 bump 版本后重拉 `GET /lsp`
> （状态栏指示由此实时更新）；`GET /formatter` 无事件，挂载时拉取一次。
> `POST /log` body 为 `{ service, level: debug|info|error|warn, message, extra? }`，
> 单条一次请求（200 返回 boolean）；`GET /api/permission/saved` 返回
> `{ data: PermissionSavedInfo[] }`（`{ id, projectID, action, resource }`），
> `DELETE /api/permission/saved/{id}` 答 204 无 body。`POST /global/upgrade`
> 返回 `{ success: true, version }` 或 `{ success: false, error }`——UI 为
> **仅展示**（无按钮）：服务端自升级由 `installation.update-available` 事件
> 提示 + 重启引导覆盖，Mock 注册该端点仅为契约覆盖。会话 tokens/费用指示
> 直接读 Session schema 的 `tokens`（input/output/reasoning/cache，展示取
> input+output+reasoning）与 `cost` 字段（服务端计算，`session.updated`
> 事件保持新鲜），无客户端估算。
>
> SSE mock 扩展 `?syncDelay=<ms>`（TASK-M10-01，设计见 docs/tasks/M10.md
> 决策 #4）：`/event` 与 `/global/event` 接受该 query，将整个场景时间线
> 推迟指定毫秒数——`server.connected` 触发的客户端全量 re-sync 会清掉
> 同步快照往返期间到达的 t=0 场景事件（E2E 首跑暴露）；测试装置经 shim
> 为每个 SSE URL 追加 `syncDelay=250`，让场景在 re-sync 落定后开播。

## 6. Backlog（实验面与 TUI 面，本期不实现）

| 端点组 | 说明 | 后续评估方向 |
|---|---|---|
| `/experimental/workspace*`（9） | 云端/远程 workspace | 远程开发场景 |
| `/experimental/worktree*`（4） | git worktree 并行开发 | 多任务并行 UX |
| `/experimental/session`、`/experimental/session/{id}/background` | 后台会话 | 任务后台化 |
| `/experimental/tool`、`/experimental/tool/ids` | 工具 schema 查询 | 高级调试面板 |
| `/experimental/resource`、`/experimental/capabilities` | 资源/能力目录 | 能力探测增强 |
| `/experimental/project/{id}/copy*`（4） | 项目复制 | 项目模板 |
| `/experimental/console*`（3） | opencode zen 控制台 | 账户体系 |
| `/experimental/control-plane/move-session` | 跨目录移动会话 | 会话整理 |
| `/sync/*`（4） | 多端同步协议 | 多客户端协同 |
| `/tui/*`（13） | 驱动 TUI 的接口 | 不适合本客户端；仅 `show-toast` 类事件做只读兼容 |
| `/api/pty*` ★、`/api/integration*` ★、`/api/credential*` ★ | V2 终端/集成/凭证 | 随 V2 面整体切换评估 |
| `/api/session/*`（V2 会话族，含 compact/revert-stage/wait/history/context） | V2 会话语义 | 随 V2 面整体切换评估 |

> ★ = V2 面独有能力，接入前需在 Mock Server 中补充对应 fixture，并验证服务端版本要求。

## 7. 事件清单（SSE，`/event` 与 `/global/event`）

客户端必须处理的事件类型（OpenAPI `Event*` schema 全集）：

| 事件 | 客户端行为 |
|---|---|
| `server.connected` | 触发会话/状态全量对齐 |
| `session.created/updated/deleted/status/idle/error/compacted/diff` | 更新 sessionStore；idle 时解锁输入、通知、萌宠待机 |
| `message.updated/removed`、`message.part.updated/removed`、`message.part.delta` | 流式渲染核心 → messagesStore |
| `permission.asked/replied`（含 V2 变体） | 权限卡片队列 |
| `question.asked/replied/rejected`（含 V2 变体） | 问题卡片队列 |
| `todo.updated` | Todo 面板刷新 |
| `file.edited`、`file.watcher.updated` | 文件树/状态刷新 |
| `vcs.branch.updated` | 状态栏分支名 |
| `lsp.updated` | 状态栏 LSP 指示 |
| `mcp.tools.changed`、`mcp.browser.open.failed` | MCP 状态与错误提示 |
| `pty.created/updated/deleted/exited` | 终端列表联动 |
| `installation.updated` / `installation.update-available` | 服务端更新提示 |
| `server.instance.disposed`、`global.disposed` | 连接状态降级处理 |
| `project.updated`、`project.directories.updated` | 项目列表刷新 |
| `tui.*` | 忽略（或日志） |
| `workspace.*`、`worktree.*` | Backlog，仅日志 |
