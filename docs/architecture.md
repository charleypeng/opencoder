# 技术架构

> 配套文档：`docs/PLAN.md` · 状态：DRAFT 待审阅

---

## 1. 仓库结构

```
opencoder/
├── .github/workflows/          # CI：lint/test/build/e2e/release
├── src-tauri/                  # Rust 核心
│   ├── src/
│   │   ├── lib.rs              # 插件注册、命令注册
│   │   ├── transport/          # 传输层（ADR-002）：http.rs(REST) / sse.rs(SSE管理器) / ws.rs(PTY)
│   │   ├── connections/        # 服务器注册表、健康监控
│   │   ├── discovery/          # mDNS 发现（mdns-sd crate）
│   │   ├── pet/                # 萌宠窗口管理（desktop only）
│   │   └── commands.rs         # 暴露给前端的 Tauri commands
│   ├── plugins/
│   │   └── glass/              # 自研：iOS 26 原生 Liquid Glass（Swift）
│   │       ├── src/            # Rust 侧
│   │       └── ios/            # Swift 侧（UITabBar/UIVisualEffectView）
│   ├── capabilities/           # 权限 ACL
│   └── Cargo.toml
├── src/                        # SolidJS 前端
│   ├── main.tsx
│   ├── App.tsx                 # 平台探测 → DesktopShell | MobileShell
│   ├── shells/
│   │   ├── desktop/            # 桌面壳：三栏布局、快捷键、命令面板
│   │   └── mobile/             # 移动壳：底部导航、Sheet、手势
│   ├── features/               # 业务功能模块（模块所有权见 PLAYBOOK）
│   │   ├── servers/            # 服务器导航/添加/健康
│   │   ├── sessions/           # 会话列表/详情/聊天流
│   │   ├── messages/           # Part 渲染器族
│   │   ├── files/              # 文件树/查看器/搜索
│   │   ├── vcs/                # diff/status/apply
│   │   ├── permissions/        # 权限请求卡片/规则
│   │   ├── questions/          # 问题卡片
│   │   ├── commands/           # 斜杠命令
│   │   ├── models/             # provider/model/agent 选择器
│   │   ├── terminal/           # xterm.js PTY
│   │   ├── settings/           # 设置中心（config/mcp/theme/i18n）
│   │   └── pet/                # 萌宠前端（动画+事件联动）
│   ├── services/               # API 抽象层（手写的领域服务）
│   │   ├── api/                # openapi-typescript 生成的类型
│   │   ├── client.ts           # ApiClient 门面（transport: invoke 生产 / fetch dev-only）
│   │   ├── sse.ts              # SSE 订阅门面（Channel + invoke；事件分发到 stores）
│   │   ├── session.ts  file.ts  pty.ts  provider.ts …
│   ├── stores/                 # Solid stores：按 serverID 切片
│   │   ├── registry.ts         # 多服务器注册表（前端镜像）
│   │   ├── connection.ts       # 每服务器：health/SSE 状态
│   │   ├── session.ts  messages.ts  files.ts …
│   ├── components/             # 共享 UI 组件（Kobalte 基座）
│   ├── i18n/                   # en.json zh-CN.json …
│   ├── styles/                 # tokens.css / themes / tailwind
│   └── platform/               # 平台能力探测与适配（desktop/mobile/ios…）
├── tests/
│   ├── mock-server/            # Node Mock OpenCode Server（M0 交付）
│   ├── fixtures/               # 录制的真实响应样本
│   ├── contract/               # 契约测试
│   ├── e2e/                    # Playwright / WebdriverIO
│   └── unit/                   # vitest（与 src 就近放置亦可）
├── docs/                       # 本计划族文档
├── package.json
└── tauri.conf.json
```

## 2. 前端分层与依赖规则

```
shells → features → stores → services → client/sse
                  ↘ components（纯 UI，不依赖 stores/services）
                  ↘ platform（能力探测，被各层依赖）
```

- **单向依赖**，禁止反向引用；`components/` 与 `platform/` 不感知业务
- ESLint `import/no-restricted-paths` 强制分层
- 每个 feature 拥有独立目录（含其组件/hooks/样式），是子 agent 并行的工作单元

## 3. 平台探测（`src/platform/`）

```ts
export type Platform =
  | { kind: "desktop"; os: "macos" | "windows" | "linux" }
  | { kind: "mobile"; os: "ios" | "android" };

export const platform: Platform = detect(); // UA + tauri os plugin + 视口综合判定
```

- `App.tsx` 根据 `platform.kind` 挂载 `DesktopShell` 或 `MobileShell`；desktop 时在内容上方挂载自定义 `TitleBar`（M8-04 窗口 chrome：macOS Overlay 红绿灯避让 / Win+Linux 无边框自定义控件）
- 功能可用性表（`platform/capabilities.ts`）：`supportsPet`、`supportsGlobalShortcut`、`supportsNativeGlass`、`supportsTray`…
- 响应式断点只作为兜底，**形态切换以平台探测为准**（避免 iPad 横屏误判）

## 4. API 客户端层（`src/services/`）

### 4.1 类型生成

- 工具：`openapi-typescript`（仅类型，零运行时）
- 输入：`docs/openapi_v1.18.11.json`（版本锁定，提交进仓库）
- 输出：`src/services/api/schema.d.ts`，脚本 `pnpm gen:api`
- 辅助：手写 `paths` 操作包装，获得端到端类型安全的 `client.GET("/session/{sessionID}/message", …)`

### 4.2 传输层（ADR-002：全部下沉 Rust，WebView 零直连）

**决策**：所有到 opencode server 的网络流量（REST + SSE + WebSocket）都经过 Rust reqwest，WebView 不直接发任何跨域请求。原因：

| 问题 | TS fetch 直连 | Rust reqwest |
|---|---|---|
| CORS | WebView 源是 `tauri://localhost`（Win/Android 为 `http://tauri.localhost`），跨域 fetch 被拦截，要求每个服务端加 `--cors`，且 TUI 自带 server 无 CORS 配置**直接连不上** | 免疫 |
| iOS ATS | 明文 HTTP 局域网服务器被 ATS 拦截，需 plist 例外 | 免疫（不走 URLSession） |
| 生命周期 | SSE 绑死 WebView，切页/挂起即断 | 连接独立存活于 Rust，前端随时 re-attach |

- **Rust 侧**：`src-tauri/src/transport/http.rs` 暴露 `http_request` command（reqwest：Basic Auth、超时、取消 token、错误分类）
- **TS 侧**：`client.ts` 保持 `ApiClient` 外观不变，transport 抽象有两个实现：生产 = `invoke("http_request")`；**dev-only = fetch**（`VITE_TRANSPORT=fetch`，仅供 Playwright E2E 与纯浏览器开发，此时 Mock Server 需开 CORS——见 `docs/testing.md` L4）——服务层与调用方零感知
- 统一错误归一：`ApiError { status, code, message, retriable }`（Rust 序列化，TS 直接消费）
- 所有 `?directory=` 参数由当前激活 project 注入（TS 侧组装）

### 4.3 SSE 管理器（Rust 侧 + Channel 推送）

- **Rust 侧**：`src-tauri/src/transport/sse.rs` —— 每条订阅一个 tokio task：reqwest 流式读取 `text/event-stream`，逐行解析（处理跨 chunk 断行），经 `tauri::ipc::Channel` 推送给订阅的 WebView
- 端点：`GET /event`（每 directory 一条流）；`GET /global/event`（每服务器一条流）
- **性能护栏**：
  - **16ms 批刷**：一帧内多个 delta 合并为数组一次推送，IPC 频率封顶 ~60/s
  - **事件过滤**：Rust 侧直接丢弃 `tui.*`、`workspace.*` 等客户端不用的事件类型
  - **lazy-parse**：大 payload 原样透传 JSON 字符串，TS 按需解析，避免双重序列化
- **可靠性**：指数退避重连（1s→2s→4s…封顶 30s）；60s 心跳超时判死重连；`server.connected` 时附带 `reconnected: true` 标记，TS 触发全量对齐；订阅句柄可显式取消（切服务器/项目时）
- **TS 侧**：`services/sse.ts` 仅保留订阅门面：`sseSubscribe(serverID, directory, onEvent)` 内部创建 Channel 并 `invoke("sse_subscribe", …)`；事件分发逻辑不变（按 `type` 路由到 store reducer）

### 4.4 服务模块（每个领域一个文件）

`session.ts / message.ts / file.ts / find.ts / vcs.ts / permission.ts / question.ts / command.ts / provider.ts / agent.ts / pty.ts / mcp.ts / config.ts / project.ts / todo.ts / lsp.ts / formatter.ts / log.ts`

统一形态：

```ts
export function createSessionService(client: ApiClient) {
  return {
    list: (dir?: string) => client.GET("/session", { params: { query: { directory: dir } } }),
    create: (input: { parentID?: string; title?: string }) => …,
    promptAsync: (sessionID: string, body: PromptInput) => …,
    // …
  };
}
```

## 5. 状态管理（`src/stores/`）

```
registryStore                       # 全部服务器（前端镜像 Rust 注册表）
└─ per serverID:
   connectionStore[serverID]        # health/version/latency/SSE 状态
   projectStore[serverID]           # projects、当前 directory
   sessionStore[serverID]           # 会话列表、状态、当前 sessionID
   messagesStore[serverID]          # sessionID → { info, parts } 归一化表
   permissionStore[serverID]        # 待处理权限请求队列
   questionStore[serverID]          # 待处理问题队列
   fileStore / vcsStore / ptyStore …
```

- **归一化存储**：`parts: Record<partID, Part>` + `order: string[]`，SSE delta 以 O(1) 更新，Solid 细粒度响应只重渲染变化的 Part
- **事件 → store 归一化入口**：`stores/events.ts` 集中处理所有 SSE 事件类型（对应 OpenAPI 中 `Event*` schema 全集）
- 持久化：`tauri-plugin-store` 保存服务器列表、UI 偏好、最近会话；会话数据不本地持久化（以服务端为准）

## 6. Rust 核心（`src-tauri/`）

### 6.1 官方插件

| 插件 | 用途 | 平台 |
|---|---|---|
| store | 服务器列表/凭证/偏好持久化 | 全平台 |
| ~~http~~ | ~~备选通道~~ → **不需要**：传输层为自研 `transport/` 模块（见 6.2），reqwest 直接使用 | — |
| notification | 会话完成/权限请求提醒 | 全平台 |
| dialog / fs | 桌面文件操作、图片附件选取 | 桌面+移动 |
| opener | 外部打开链接/分享 URL | 全平台 |
| os | 平台探测 | 全平台 |
| window-state | 桌面窗口位置记忆（M8-04 已接线） | 桌面 |
| single-instance | 桌面单实例（M8-04 已接线：二次启动聚焦主窗口） | 桌面 |
| global-shortcut | 全局快捷键（唤起） | 桌面 |
| haptics | 移动端触觉反馈 | 移动 |
| barcode-scanner | 扫码添加服务器（二维码含 URL+端口） | 移动 |
| biometric | 可选：锁定应用 | 移动 |
| updater | 桌面自动更新 | 桌面 |
| process / shell | 桌面辅助 | 桌面 |

### 6.2 自研模块

| 模块 | 说明 |
|---|---|
| `transport/` | **传输层核心（ADR-002）**：`http.rs` = reqwest REST 通道（Basic Auth/超时/取消/错误分类，免疫 CORS 与 iOS ATS）；`sse.rs` = SSE 管理器（每订阅一个 tokio task，逐行解析、事件过滤、16ms 批刷、指数退避重连，经 `tauri::ipc::Channel` 推送 WebView）；`ws.rs` = PTY WebSocket 通道（M6） |
| `connections/` | 服务器注册表（权威数据源，前端镜像）；`health-monitor` 每 15s `GET /global/health`（复用 transport）并记录延迟；状态变化 emit 到前端 |
| `discovery/` | `mdns-sd` crate 扫描 `_opencode._tcp`（服务端 `--mdns` 广播）；发现结果 emit `server-discovered` |
| `pet/` | 桌面萌宠：独立 `WebviewWindow`（透明、无边框、always-on-top、skip-taskbar、忽略鼠标事件可配置）；接收前端事件驱动动画状态机 |
| `plugins/glass/` | iOS：Swift 注入原生 `UITabBar`/`UIVisualEffectView`（iOS 26 SDK 编译即自动获得 Liquid Glass 材质），web↔native 双向桥（参考社区 `tauri-plugin-ios-glass-tabbar` 模式）；macOS：`window-vibrancy` 的 `apply_liquid_glass`（macOS 26+） |

### 6.3 Tauri Commands（前端 ⇄ Rust 契约）

```
# 传输层（ADR-002，所有服务端流量必经）
http_request(request) -> response                                   # REST 通道（reqwest）
sse_subscribe(server_id, directory?, channel) -> subscription_id    # SSE 订阅（Channel 推送）
sse_unsubscribe(subscription_id)
pty_ws_connect(pty_id, token, channel) -> connection_id             # PTY WebSocket（M6）
pty_ws_send(connection_id, data) / pty_ws_close(connection_id)
# 服务器与健康
list_servers / add_server / update_server / remove_server
get_server_health(server_id) / probe_server(url, auth)
start_mdns_discovery / stop_mdns_discovery
pet_show / pet_hide / pet_set_state(state)
glass_set_tab_items(items) / glass_set_active(key) / glass_set_hidden(hidden)   # iOS
set_badge(count)                                                              # iOS dock/tab 角标
```

## 7. 关键数据流

### 7.1 发送消息并流式渲染（核心链路）

```
用户输入 → features/sessions/PromptBox
  → services/session.promptAsync(sessionID, body)
      → invoke("http_request") → Rust reqwest → POST /session/{id}/prompt_async → 204
  → （服务端开始生成）
  → Rust SSE 管理器（tokio task）收到 message.part.updated(delta) × N
      → 过滤 + 16ms 批刷 → Channel 推送到 WebView
  → services/sse.ts → stores/events.ts → messagesStore.applyPartDelta
  → Solid 细粒度更新 → 对应 Part 组件单独重渲染
  → SSE: session.status(idle) → 输入框解锁
      → Rust 侧直接发原生完成通知（无需 WebView 前台）+ 萌宠回到待机
```

### 7.2 权限请求（跨页全局）

```
Rust SSE 管理器: permission.asked → Channel → permissionStore.enqueue
  → 全局 PermissionSheet（桌面弹层/移动底部 Sheet + 系统通知 + 角标）
  → 用户选择 → invoke("http_request") → POST /permission/{requestID}/reply（或 /session/{id}/permissions/{pid}）
  → SSE: permission.replied → 出队
```

### 7.3 健康检查

```
Rust health-monitor（15s 间隔，每服务器独立）
  → GET /global/health → { healthy, version } + 延迟
  → emit "server-health" → connectionStore 更新
  → 服务器卡片绿灯/黄灯(慢)/红灯(不可达)；连续 3 次失败 → SSE 标记断开并暂停依赖请求
```

## 8. 安全与凭证

- 服务器密码仅存 `tauri-plugin-store` 加密文件；可选升级 stronghold（决策点 D5）
- Basic Auth 仅作用于用户配置的服务器地址；HTTPS/SSH 隧道由用户侧保障，添加服务器时给出明文 HTTP 风险提示
- CSP：WebView 不再发起任何跨域网络请求（全部走 Rust transport），`connect-src` 可收紧至仅 `ipc:` 自身；凭证经 invoke 传给 Rust 后仅在内存中注入请求头，不写日志

## 9. 性能预算

| 指标 | 目标 |
|---|---|
| 首屏（服务器导航页） | 桌面 < 1.5s，移动 < 2.5s |
| 消息流渲染 | token delta → 上屏 < 50ms，长会话(1000 parts)滚动 60fps（虚拟列表） |
| SSE 重连 | 断网恢复后 < 3s 自动重连并对齐 |
| 安装包 | 桌面 < 15MB，移动 < 25MB |
| 内存（桌面常驻） | < 250MB |
