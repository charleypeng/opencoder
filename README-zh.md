# opencode-client

基于 [Tauri 2](https://tauri.app) 与 [SolidJS](https://www.solidjs.com) 构建的 [OpenCode](https://opencode.ai) 跨平台桌面与移动客户端。

> 状态：**规划中** — 里程碑 M0（工程基建）已完成，M1 及后续进行中。详见 [docs/PLAN.md](docs/PLAN.md)。

![Build status](https://img.shields.io/github/actions/workflow/status/charleypeng/opencoder/ci.yml?branch=main&label=CI)
[English](./README.md)

## 功能特性

- **一套代码库，五个平台**：macOS / Windows / Linux / iOS / Android
- **双形态 UI**：桌面壳（鼠标 + 快捷键）与移动壳（触屏优先），共享同一组件库
- **多服务器管理**：可同时连接多个 `opencode serve` 实例，带健康检查、mDNS 自动发现与服务器导航首页
- **完整 API 覆盖**：按优先级分阶段实现 OpenAPI 规范中的全部功能（162 端点 / 472 schema，见 [docs/api-coverage.md](docs/api-coverage.md)）
- **快乐编码（Vibe Coding）**：桌面版内置萌宠陪伴，与编码事件联动
- **i18n 先行**：首批支持 English + 简体中文

## 技术栈

| 层       | 选型                                                     |
| -------- | -------------------------------------------------------- |
| 应用框架 | Tauri 2.x（Rust）                                        |
| 前端框架 | SolidJS + TypeScript                                     |
| 构建     | Vite 6 + `@solidjs/router`                               |
| 样式     | Tailwind CSS v4 + CSS 变量设计令牌                       |
| 组件基座 | Kobalte（无障碍 headless 组件）                          |
| API 类型 | `openapi-typescript` 从 OpenAPI 3.1 规范生成             |
| 传输层   | Rust `reqwest`（REST + SSE + WebSocket），WebView 零直连 |
| 终端     | xterm.js，经 Rust WebSocket/PTY 通道                     |
| 状态     | Solid stores，按服务器维度切片                           |
| i18n     | i18next + `solid-i18next`                                |
| 萌宠     | Rive 动画 + 独立透明窗口（桌面）                         |
| 代码质量 | ESLint + Prettier + clippy/fmt + husky/lint-staged       |

## 架构概览

```
┌───────────────────────────────────────────────────────────┐
│                  SolidJS 前端（一套代码）                    │
│  桌面壳 · 移动壳 · 共享功能模块                              │
│  Stores（按服务器切片）← Services（API 抽象层）              │
│               ApiClient / SSE 门面（TS）                    │
└───────────────────────────┬───────────────────────────────┘
                    Tauri IPC（invoke / Channel）
┌───────────────────────────▼───────────────────────────────┐
│                     Rust 核心（src-tauri）                  │
│   transport: http（REST）· sse · ws（PTY）                  │
│   connections · 健康监控 · mDNS 发现                        │
│   萌宠窗口 · glass 插件（iOS/macOS）                        │
└───────────────────────────┬───────────────────────────────┘
                 HTTP / SSE / WebSocket（reqwest）
      opencode serve（本地）   （LAN / mDNS）   （远程）
```

所有到 OpenCode 服务器的网络流量都经过 Rust 传输层（ADR-002），可规避 WebView 的 CORS 限制与 iOS ATS 拦截，且 SSE/WebSocket 连接生命周期独立于 WebView。详见 [docs/architecture.md](docs/architecture.md)。

## 快速开始

前置要求：Node.js >= 20、pnpm、Rust 工具链（桌面构建需要）。

```bash
pnpm install        # 安装依赖
pnpm tauri dev      # 以开发模式运行桌面应用
```

常用脚本：

| 命令                 | 用途                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `pnpm verify`        | 质量门禁：lint + 格式 + 类型检查 + 测试 + codegen 漂移检测（提交前必须通过） |
| `pnpm test`          | 单元测试（vitest）                                                           |
| `pnpm mock:start`    | 启动 Mock OpenCode Server（Node，REST + SSE + 场景脚本）                     |
| `pnpm mock:test`     | Mock Server 自测                                                             |
| `pnpm gen:api`       | 从 OpenAPI 契约重新生成 API 类型                                             |
| `pnpm gen:api:check` | 校验已提交类型与契约一致（CI 使用）                                          |

### API 契约与类型生成

- 基准：`docs/openapi_v1.18.11.json`（OpenAPI 3.1，版本锁定）
- 生成类型：`src/services/api/schema.d.ts`（`openapi-typescript`，脚本 `scripts/gen-api.mjs`）

契约升级流程：替换版本化规范文件 → `pnpm gen:api` → `pnpm gen:api:check` → `pnpm exec tsc -b` → 两个文件一并提交。

## 文档地图

| 文档                                             | 内容                                        |
| ------------------------------------------------ | ------------------------------------------- |
| [docs/PLAN.md](docs/PLAN.md)                     | 总体规划、里程碑、决策点                    |
| [docs/architecture.md](docs/architecture.md)     | 技术架构、目录结构、数据流                  |
| [docs/api-coverage.md](docs/api-coverage.md)     | 162 端点 → 功能域 → 优先级/里程碑映射       |
| [docs/ui-design.md](docs/ui-design.md)           | 设计系统、桌面/移动形态、Liquid Glass、萌宠 |
| [docs/testing.md](docs/testing.md)               | 分层测试体系、Mock Server、CI               |
| [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md) | 子 Agent 执行手册（任务卡格式、提交规范）   |
| [docs/tasks/M0.md … M10.md](docs/tasks/M0.md)    | 83 个可执行任务卡                           |

## 贡献

开发环境搭建、分支与提交规范、测试纪律见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 变更记录

发布历史见 [CHANGELOG-zh.md](CHANGELOG-zh.md)。

## 许可证

[MIT](LICENSE)
