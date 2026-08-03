# 测试体系

> 配套文档：`docs/PLAN.md` §7 · 状态：DRAFT 待审阅

---

## 1. 测试金字塔

```
        ┌──────────┐
        │ L5 移动冒烟 │  手动 + CI best-effort
      ┌─┴────────────┴─┐
      │ L4 E2E          │  Playwright（UI×Mock）+ WebdriverIO（桌面壳）
    ┌─┴──────────────────┴─┐
    │ L3 契约测试            │  Mock OpenCode Server × OpenAPI
  ┌─┴────────────────────────┴─┐
  │ L2 组件测试                  │  vitest + @solidjs/testing-library
┌─┴──────────────────────────────┴─┐
│ L1 单元测试 + L0 静态检查           │  vitest / cargo test / clippy / eslint
└────────────────────────────────────┘
```

## 2. Mock OpenCode Server（基石，M0 交付）

`tests/mock-server/`：Node (tsx) 实现的 OpenCode 协议模拟器，所有前端/契约/E2E 测试默认不依赖真实服务端。

### 2.1 数据来源（双轨）

1. **生成轨**：从 `docs/openapi_v1.18.11.json` 读取 schema，对带 `example`/`examples` 的端点自动生成响应骨架
2. **录制轨**：`tests/fixtures/` 存放从真实 `opencode serve` 录制的 JSON 响应与 SSE 事件序列（录制脚本 `pnpm fixtures:record <baseURL>`），覆盖：会话列表、消息流（含 tool/reasoning/file/patch 全 Part 类型）、权限请求、问题、文件树、diff、pty 元数据

### 2.2 行为模拟

| 能力 | 说明 |
|---|---|
| REST 全端点 | P0–P4 全部端点返回 fixture 或 schema 生成数据；未知端点 404 |
| SSE 流 | `GET /event`、`GET /global/event`：先发 `server.connected`，再按脚本化时间线回放事件序列 |
| 场景脚本 | `scenarios/*.ts`：如「发送 prompt → 3 个 text delta → tool 调用 → permission.asked → 应答 → 完成」可编程编排 |
| 故障注入 | `?__fail=500`、`?__slow=3000`、SSE 中途断流、乱序 delta —— 用于重连/容错测试 |
| 认证模拟 | 可选开启 Basic Auth 校验，匹配真实 `OPENCODE_SERVER_PASSWORD` 行为 |
| CORS dev 模式 | `mock:start --cors` 放行 `tauri://localhost` / `http://tauri.localhost` / vite dev 源——仅供 dev-only fetch transport（Playwright E2E）使用；生产路径（Rust transport）不需要 |
| 版本声明 | `/global/health` 返回 `{ healthy: true, version: "1.18.11-mock" }` |

### 2.3 使用方式

```bash
pnpm mock:start          # 默认 :14096
pnpm test:contract       # vitest 跑 tests/contract（自动拉起 mock）
pnpm test:e2e            # Playwright 以 VITE_MOCK=1 启动 UI + mock
```

## 3. 分层细则

### L0 静态检查（每次 commit 经 lint-staged）

- `cargo clippy -- -D warnings`、`cargo fmt --check`
- `eslint --max-warnings 0`、`tsc --noEmit`、`prettier --check`
- OpenAPI 变更检测：`pnpm gen:api --check`（schema.d.ts 与 json 漂移即失败）

### L1 单元测试

- 前端：vitest。覆盖 `services/`（TS 门面的 invoke 参数组装、ApiError 消费、Channel 事件注入 mock——以"模拟 Channel 事件源"驱动 store 测试）、`stores/`（reducer、归一化、事件路由）、`platform/`、`i18n` key 完整性
- Rust：`cargo test`（**transport 是重点**：SSE 逐行解析器——含乱序/断行/跨 chunk、16ms 批刷窗口、指数退避重连时序（tokio-test 时间控制）、http 错误分类；registry、health-monitor 状态机、pet 状态映射）
- **门槛**：services/stores 行覆盖 ≥ 80%，Rust SSE 解析器行覆盖 ≥ 95%

### L2 组件测试

- vitest + `@solidjs/testing-library` + jsdom
- 每个共享组件 ≥ 1 渲染测试 + 交互测试；消息 Part 渲染器族按 fixture 全类型快照（snapshot 审查纳入 PR）
- 玻璃组件在 `prefers-reduced-motion` 下的降级渲染测试

### L3 契约测试

- `tests/contract/`：以 Mock Server 为准入。**传输层在 Rust（ADR-002），契约测试因此分两层**：
  - **Rust 集成测试**：`src-tauri/tests/` 直接起 transport 对 Mock Server 发请求，验证每个已接入端点的请求构造（路径/方法/query/body/认证头）与响应解析、SSE 订阅事件序列
  - **TS 门面测试**：验证 TS 侧组装出正确的 invoke 载荷（mock invoke 层）
- 反向校验：Mock Server 对未知请求返回 501 并记录，测试结束断言「客户端发出的每个请求都在 OpenAPI 中存在」（防止调用不存在的端点）
- 每接入一个端点（任务卡标注）必须附带 ≥ 1 条契约用例

### L4 E2E

> **ADR-002 配套**：生产传输在 Rust，浏览器里没有 invoke。因此 `services/` 的 transport 抽象保留一个 **dev-only fetch 实现**（`VITE_TRANSPORT=fetch` 时启用，仅用于测试与纯浏览器开发；Mock Server 在 dev 模式开启 CORS 放行）。Playwright 借此在无 Tauri 环境下跑 UI 级 E2E；真实 invoke 路径由 tauri-driver 壳级测试覆盖。

**Playwright（UI 级，CI 主跑）**：`vite dev`（`VITE_TRANSPORT=fetch`）+ Mock Server（CORS on），覆盖 12 条核心旅程：

| # | 旅程 |
|---|---|
| E01 | 添加服务器（手动 URL）→ 健康检查变绿 → 进入项目 |
| E02 | mDNS 发现列表出现服务器并可一键添加（mock 发现事件） |
| E03 | 新建会话 → 发 prompt → 流式渲染 text+tool → 完成态 |
| E04 | 中断生成 → 状态归零 |
| E05 | 权限请求出现 → 允许(remember) → 后续不再询问 |
| E06 | 问题卡片回答 → 流程继续 |
| E07 | 会话重命名/删除/搜索 |
| E08 | 文件树打开文件 → 内容渲染；⌘P 快速打开 |
| E09 | 全文搜索 → 跳转命中行 |
| E10 | 会话 diff 视图展示增删 |
| E11 | 终端创建 → 输入命令 → 回显 |
| E12 | 断网 → 重连 → 会话状态自动对齐 |

**WebdriverIO + tauri-driver（壳级，桌面 CI）**：窗口创建、自定义 TitleBar、托盘、快捷键路由、萌宠窗口生命周期。

### L5 移动冒烟

- iOS Simulator + Android Emulator：安装启动、添加服务器、发消息、权限 Sheet、终端打开 —— 每里程碑手动跑一次 checklist（`docs/tasks/M7.md` 附录）
- CI best-effort：`tauri ios build --debug` / `tauri android build --debug` 保证可编译；真机验证在 M7/M10 由用户或指定设备执行

## 4. CI 流水线（GitHub Actions）

| 工作流 | 触发 | 内容 |
|---|---|---|
| `ci.yml` | 每个 PR/push | L0 + L1 + L2 + L3（matrix: ubuntu；node & rust 缓存） |
| `e2e.yml` | PR | L4 Playwright（ubuntu + xvfb）；失败上传 trace/截图 |
| `desktop.yml` | tag/手动 | tauri build matrix：macOS(arm64+x64 universal)、Windows(x64 msi/nsis)、Linux(deb/AppImage) |
| `mobile.yml` | 手动/里程碑 | iOS(.ipa debug) + Android(.apk/.aab debug) 编译验证 |
| `release.yml` | tag `v*` | 签名 + notarize + 产物上传 + 生成 Release notes（从 CHANGELOG 提取） |

## 5. 测试纪律（写入每个任务卡）

1. 新服务层方法 → 契约用例（L3）
2. 新 store 逻辑 → 单元测试（L1）
3. 新组件/交互 → 组件测试（L2）；涉及核心旅程 → 更新/新增 E2E（L4）
4. 修 bug → 先写复现测试再修
5. `pnpm verify`（= L0+L1+L2+L3 一键）必须通过才能 commit
6. CHANGELOG 双文件同步更新后与代码同 commit
