# OpenCode Client App — 总体实施计划

> 版本：v1.0（待审阅） · 日期：2026-08-03
> 状态：**DRAFT — 等待用户过目批准后执行**
> 依据文档：`docs/openapi_v1.18.11.json`（162 端点 / 472 schema）、https://opencode.ai/docs/

---

## 1. 项目愿景

基于 **Tauri 2** 打造一个全新的、跨全平台的 OpenCode 客户端：

- **一套代码库，五个平台**：macOS / Windows / Linux / iOS / Android
- **双形态 UI**：同一组件库，两种交互范式
  - **Desktop**：简洁高效、现代化；鼠标 + 快捷键 + 右键菜单优先
  - **Mobile**：精致简洁、触屏优先、功能齐全；细节处有高级动效，**iOS 26 支持原生 Liquid Glass 液态玻璃**
- **多服务器管理**：可同时连接多个 `opencode serve` 实例，带健康检查、mDNS 自动发现、服务器导航首页
- **完整 API 覆盖**：按优先级分阶段实现 OpenAPI 规范中的全部功能
- **快乐编码（Vibe Coding）**：桌面版内置萌宠陪伴，与编码事件联动
- **国际化**：i18n 架构先行，首批支持 English + 简体中文

**工作名称**：`opencoder`（见 §10 决策点 D1）

## 2. 范围与非目标

### 2.1 范围内

| 类别 | 内容 |
|---|---|
| 平台 | macOS、Windows、Linux（桌面）；iOS、Android（移动） |
| 服务端兼容 | opencode server ≥ v1.18（以 `docs/openapi_v1.18.11.json` 为契约基准） |
| 功能 | OpenAPI 全部稳定端点（见 `docs/api-coverage.md` 优先级表） |
| 交付物 | 桌面安装包、移动端 App、README/README-zh、CHANGELOG/CHANGELOG-zh |

### 2.2 非目标（本期不做）

- 不实现 OpenCode 服务端本身（本应用是纯客户端，连接外部 `opencode serve`）
- 不支持浏览器 Web 版（Tauri WebView 专用 API 较多，Web 版留待后续评估）
- `/experimental/*` 端点（workspace/worktree/sync/console 等 21 个）标记为 **Backlog**，待其稳定后纳入
- `/tui/*` 控制端点（13 个）仅做只读对接评估，默认不实现（属于驱动 TUI 的接口，非客户端场景）

## 3. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 应用框架 | **Tauri 2.x**（Rust） | 单一代码库覆盖 5 平台；移动端已可用于生产；包体小 |
| 前端框架 | **SolidJS + TypeScript**（推荐，见决策点 D2） | 细粒度响应式，天然契合 token 级流式渲染；运行时小，利于移动端 WebView 性能 |
| 构建 | Vite 6 + `@solidjs/router` | HMR 支持真机/模拟器 |
| 样式 | **Tailwind CSS v4** + CSS Variables 设计令牌 | 主题/深浅色/平台差异化统一由 token 驱动 |
| 组件基座 | Kobalte（无障碍 headless 组件）+ 自研 | 移动端需深度定制触控行为 |
| API 类型 | `openapi-typescript` 从 OpenAPI 3.1 生成 | 与契约同步，472 个 schema 零手抄 |
| 传输层 | **Rust reqwest 统一下沉**（REST + SSE + WebSocket 全走 Rust，TS 仅留类型安全门面） | 免疫 WebView CORS 与 iOS ATS；连接生命周期独立于 WebView；详见 ADR-002 |
| 终端 | xterm.js，PTY 数据经 Rust WebSocket 通道 + Channel 推送（对接 `/pty/{id}/connect`） | 与传输层统一，避免 WebView 直连 |
| 状态 | Solid stores（按 server 维度切片） | 多服务器并行数据隔离 |
| i18n | i18next + `solid-i18next` | 生态成熟，支持复数/插值/懒加载 |
| 萌宠 | Rive 动画 + 独立透明无边框窗口 | 状态机驱动，跨桌面三平台 |
| Liquid Glass | 自研 Tauri Swift 插件（iOS 26 原生 UIKit 材质）+ CSS 磨砂兜底 | 见 `docs/ui-design.md` §5 |
| 代码质量 | ESLint + Prettier + cargo clippy/fmt + husky/lint-staged | 提交即检查 |

**关键架构决策（ADR-001）：双 API 面策略**
OpenCode 同时暴露稳定端点（`/session`、`/file`、`/event`…）与新一代 V2 端点（`/api/session`、`/api/event`…，返回 401 需鉴权、事件粒度更细）。计划如下：

- **v1.0 基于稳定端点实现**（官方 TUI/Web 客户端同款，行为已验证）
- 服务层（`src/services/`）以接口抽象隔离传输细节，未来可平滑切换 V2
- `/api/*` 的独有功能（integration、credential、permission saved rules）按需在对应里程碑单独接入

**关键架构决策（ADR-002）：传输层整体下沉 Rust**
所有到 opencode server 的网络流量（REST / SSE / WebSocket）都经过 Rust reqwest，WebView 零直连：

- **CORS 免疫**：WebView 源为 `tauri://localhost`，跨域 fetch 会被拦截（且 TUI 自带 server 无 `--cors` 配置）；Rust 不受影响
- **iOS ATS 免疫**：局域网明文 HTTP 不走 URLSession，无需 plist 例外
- **生命周期独立**：SSE/WS 连接由 Rust tokio task 持有，切页/挂起不断流；事件经 `Channel` 推送（过滤 + 16ms 批刷护栏）
- TS 侧 `ApiClient` 门面不变（底层 `invoke("http_request")`），服务层与测试策略不受影响。详见 `docs/architecture.md` §4.2/§4.3

## 4. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    SolidJS Frontend (一套代码)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Desktop Shell │  │ Mobile Shell │  │  Shared Features │   │
│  │ (键鼠/快捷键) │  │ (触控/Glass) │  │ (Chat/Files/PTY) │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         └──────────┬───────┴───────────────────┘              │
│            ┌───────▼────────┐   ┌──────────────────┐          │
│            │ Stores (按服务器 │   │ Services (API 抽象层)│        │
│            │   切片/归一化)   │   │ session/file/pty/… │          │
│            └───────┬────────┘   └────────┬─────────┘          │
│                  ┌─▼─────────────────────▼─┐                  │
│                  │ ApiClient/SSE 门面 (TS)   │  ← 零网络直连     │
│                  │ 类型由 OpenAPI 生成        │                  │
│                  └────────────┬────────────┘                  │
└───────────────────────────────┼───────────────────────────────┘
                     Tauri IPC (invoke / Channel)
┌───────────────────────────────▼───────────────────────────────┐
│                    Rust Core (src-tauri)                       │
│  transport: http.rs(REST) · sse.rs(SSE管理器) · ws.rs(PTY)     │
│  connection-registry · health-monitor · mdns-discovery        │
│  pet-window · glass-plugin(iOS/macOS) · shortcuts · tray      │
└────────────────────────────┬───────────────────────────────────┘
                             │ HTTP / SSE / WebSocket (reqwest)
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       opencode serve  opencode serve  opencode serve
        (local:4096)     (LAN/mDNS)      (remote/ssh)
```

详细分层、目录结构、数据流、Rust 插件清单见 **`docs/architecture.md`**。

## 5. 里程碑路线图

> 每个里程碑拆分为若干可独立交付的小任务（任务卡见 `docs/tasks/M*.md`）。
> 执行规则：**每完成一个任务 → 补测试 → 更新 CHANGELOG.md + CHANGELOG-zh.md → 单独 commit**。

| 里程碑 | 主题 | 出口标准（DoD） | 任务数 |
|---|---|---|---|
| **M0** | 工程基建 | 仓库可构建；CI 绿；codegen 从 OpenAPI 产出类型；Mock Server 可启动 | 8 |
| **M1** | 多服务器连接层 | 可添加/编辑/删除服务器；健康检查与延迟显示；服务器导航首页；凭证安全存储 | 9 |
| **M2** | 会话核心 MVP | 项目/目录切换；会话 CRUD；发送 prompt 并流式渲染 text/reasoning/tool；中断 | 10 |
| **M3** | 消息完整渲染 | 全部 Part 类型渲染（file/patch/snapshot/step/subtask/retry/compaction）；Todo 面板 | 8 |
| **M4** | 文件与 VCS | 文件树/查看器/三种搜索；文件状态；会话 diff；VCS status/diff/apply | 8 |
| **M5** | 权限·问题·命令·模型 | 权限请求/应答/记忆规则；问题卡片；斜杠命令；agent/model/provider 选择与 OAuth | 8 |
| **M6** | 终端与高级会话 | xterm.js PTY 终端；fork/revert/unrevert/share/summarize/init；子会话树 | 7 |
| **M7** | 移动端形态 | 移动端 Shell + 底部导航；iOS 26 原生 Liquid Glass；手势/安全区/触觉反馈；扫码添加服务器 | 10 |
| **M8** | 桌面端体验 | 快捷键体系 + 命令面板；右键菜单；托盘；萌宠窗口；通知；自动更新 | 9 |
| **M9** | i18n·主题·设置·打磨 | en + zh-CN 全量；深浅主题；Config/MCP 管理 UI；无障碍与性能过关 | 8 |
| **M10** | 测试加固与发布 | E2E 套件全绿；五平台打包/签名；README/README-zh；发布流水线 | 6 |

**总计约 83 个任务**。M0–M2 为串行关键路径；M3–M6 部分可并行（不同子 agent 负责不同模块，文件不重叠）；M7/M8 可并行；M9 依赖 M2–M8；M10 收尾。

## 6. 子 Agent 执行模式

实施阶段每个任务卡由一个子 agent 独立完成。任务卡是自包含的：目标、前置依赖、涉及文件、API 端点、验收标准、测试要求、commit 规范。详见 **`docs/AGENT_PLAYBOOK.md`**，包含：

- 任务卡格式说明
- 子 agent prompt 模板（直接可复制派发）
- 执行循环：读取任务 → 实现 → 测试 → Changelog → Commit → 汇报
- 并行安全规则（模块所有权表，避免文件冲突）
- Review Gate：每个里程碑结束由主 agent/用户验收后才进入下一里程碑

## 7. 测试体系（概要）

分层策略，详见 **`docs/testing.md`**：

| 层 | 工具 | 覆盖目标 |
|---|---|---|
| L0 静态 | clippy / eslint / tsc | 全量，零警告 |
| L1 单元 | vitest + cargo test | services/stores/utils ≥ 80% |
| L2 组件 | vitest + @solidjs/testing-library | 共享组件与关键交互 |
| L3 契约 | **Mock OpenCode Server**（Node 实现，响应来自 OpenAPI 示例 + 真实录制 fixture） | 每个接入的端点至少 1 条契约用例 |
| L4 E2E | Playwright（UI against Mock Server）+ tauri-driver/WebdriverIO（桌面壳） | 核心用户旅程 12 条 |
| L5 移动冒烟 | iOS Simulator / Android Emulator 手动 + CI best-effort | 安装、连接、发消息 |

**Mock Server 是测试体系的基石**，在 M0 就交付，后续所有任务默认不依赖真实 opencode server。

## 8. 工程规范

- **分支**：`main` 保护；任务分支 `task/M<x>-<nn>-<slug>`；里程碑合并
- **Commit**：Conventional Commits（`feat(chat): ...`），一个任务一个 commit
- **Changelog**：Keep a Changelog 格式；**每个 feat/fix commit 必须同步更新 `CHANGELOG.md` 与 `CHANGELOG-zh.md`**
- **文档**：`README.md`（英文主）+ `README-zh.md`；代码注释英文；用户可见字符串一律走 i18n key
- **API 契约**：OpenAPI 文件变更时重跑 codegen 并 diff 审查

## 9. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| iOS Liquid Glass 真机效果依赖 Xcode 26 / iOS 26 SDK | 高 | 三档降级方案（原生材质 → CSS 磨砂 → 纯色），老系统优雅降级；M7 早期做 Spike 验证 |
| opencode API 双轨（legacy vs /api V2）变动 | 中 | 服务层抽象；契约测试锁定 v1.18.11 行为；版本探测（`/global/health` 返回 version）做兼容分支 |
| 移动端 PTY/WebSocket 在 WebView 的稳定性 | 中 | M6 做桌面先行，M7 做移动端适配并准备降级（只读输出模式） |
| Tauri iOS/Android 构建链复杂（证书/签名/模拟器） | 中 | M0 即搭建移动 CI 冒烟；签名配置文档化 |
| SSE 长连接在移动后台被挂起 | 中 | 连接由 Rust 持有，存活能力强于 WebView；前后台切换自动重连 + 状态拉取补偿（轮询 `/session/status` 对齐）；iOS 后台时限内可借 background task 收尾 |
| 萌宠窗口在 Linux 各 DE 的透明支持差异 | 低 | 不支持透明的环境降级为普通小窗 |

## 10. 待确认的决策点（请过目时拍板）

| # | 决策 | 建议 | 备选 |
|---|---|---|---|
| **D1** | 应用命名 |  `opencoder`  | 正式名称（影响包名/bundle id/图标） |
| **D2** | 前端框架 | **SolidJS**（流式渲染性能最优、包体最小） | React（生态最大、招人容易） |
| **D3** | 移动端节奏 | 核心功能（M2–M6）桌面先行，M7 统一做移动形态 | 移动/桌面每里程碑同步推进（慢但早验证） |
| **D4** | 萌宠形式 | **Rive 状态机动画**（轻量、可编程联动事件） | Live2D Cubism（更萌但 SDK 重、授权需注意） |
| **D5** | 服务器凭证存储 | tauri-plugin-store（加密由 OS Keychain 经 stronghold 可选增强） | stronghold 强制 |
| **D6** | `/experimental/*` | 全部进 Backlog | 挑选 workspace/worktree 提前支持 |

---

## 附：文档地图

| 文件 | 内容 |
|---|---|
| `docs/PLAN.md`（本文） | 总体规划、里程碑、决策点 |
| `docs/architecture.md` | 技术架构、目录结构、数据流、Rust 插件清单 |
| `docs/api-coverage.md` | 162 端点 → 功能域 → 优先级/里程碑映射 |
| `docs/ui-design.md` | 设计系统、桌面/移动形态、Liquid Glass 方案、萌宠 |
| `docs/testing.md` | 分层测试体系、Mock Server、CI |
| `docs/AGENT_PLAYBOOK.md` | 子 agent 任务卡格式与派发模板 |
| `docs/tasks/M0.md … M10.md` | 83 个可执行任务卡 |
| `docs/openapi_v1.18.11.json` | API 契约基准 |
