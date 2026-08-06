# 设置中心完善计划（Settings 按钮 → 设置页：提供商 / 模型 / 主题 / 语言）

> 状态：DRAFT — 等待用户过目批准后执行
> 日期：2026-08-06
> 关联文档：`docs/PLAN.md`（M5/M9）、`docs/architecture.md`（§5 状态层）、`docs/ui-design.md`（§7 主题）

---

## 1. 目标

把「设置」做成一个完整、聚合、可被新用户一眼找到的入口，集中管理四类核心偏好：

1. **模型提供商**（已链接 / 可添加）
2. **模型选择**（全局默认 + 按会话）
3. **App 颜色显示模式**（深色 / 浅色 / 跟随系统 + 强调色）
4. **语言**（English / 简体中文）

## 2. 现状盘点（重要：大部分已存在，本计划是"聚合 + 补齐"而非从零实现）

| 能力 | 现状 | 位置 | 缺口 |
|---|---|---|---|
| 设置入口（桌面） | ✅ 主区 tab bar gear 按钮 → settings 视图 | `DesktopShell.tsx`（`settings-toggle` → `setMainView("settings")`） | 入口不够显眼；无全局快捷键直达（⌘, 已注册 ✅） |
| 设置入口（移动端） | ✅ Settings tab | `MobileShell` → `SettingsPage variant="mobile"` | 无 |
| 设置页框架 | ✅ 11 分区侧边导航 + 搜索 | `features/settings/SettingsPage.tsx` + `sections.tsx` 注册表 | 无 |
| 提供商管理 | ✅ API key 表单 + OAuth 授权 + 连接状态徽标 | `features/settings/providers/ProviderKeys.tsx`（providers 分区） | **缺"添加提供商"入口**（目前只管理服务端已存在的 provider 的认证） |
| 模型选择 | ⚠️ 仅 PromptBox chip（按会话生效） | `features/models/ModelPicker.tsx`（models 分区不存在） | **设置页无全局默认模型选择** |
| 颜色显示模式 | ✅ dark/light/system + 6 强调色 + 自定义 + OLED | `AppearanceSection.tsx`（appearance 分区） | 无（与移动端主题一致） |
| 语言 | ✅ en/zh-CN 切换 + 持久化 | `LanguageSection.tsx`（language 分区） | 无 |

**结论**：真正的增量是 ① 设置页新增「模型」分区（全局默认模型）；② 提供商分区补「可添加」；③ 设置入口增强（桌面更显眼 + 移动端一致）；④ 全链路联动与走查。

## 3. 关键契约核实（实施前必须完成）

- `GET /provider` → `{ all: Provider[], default: Record<providerID, modelID>, connected: string[] }`（M5-05 已核实）
- 服务端是否支持**动态添加 provider**：核查 openapi_v1.18.11.json 中 config/providers 相关端点（`GET/PATCH /config`、`GET/PATCH /global/config`，M9-05 已实现 Config UI）。若契约允许写入 providers 配置（本地/远程），则"添加提供商"= 配置写入 + 重拉目录；否则降级为"管理已存在 provider 的认证 + 文档引导用 opencode.json 添加"。
- `Session.model = { id, providerID }`；`activeModelFor` 解析链：会话选择 → 配置默认 → 首个已连接（M5-05 已实现，models store 现成）。

## 4. 改动范围（模块所有权）

| 任务 | 模块 | 涉及文件 |
|---|---|---|
| T1 设置页新增「模型」分区 | `src/features/settings/models/`（新） | `ModelsSection.tsx`、`sections.tsx` 注册、i18n 键 |
| T2 全局默认模型选择器 | `src/features/models/` | 抽取 `ModelPickerContent`（已存在，187 行）复用；新增"设为默认"动作 → `setConfigDefault`/`setDefaultModel` store 动作（models store 已有 `setConfigDefault`） |
| T3 提供商「可添加」入口 | `src/features/settings/providers/` | `ProviderKeys.tsx` 增"Add provider"按钮 → 依契约走 Config PATCH 或引导文案 |
| T4 设置入口增强 | `src/shells/desktop/`、`src/shells/mobile/` | 桌面标题栏/侧栏更显眼齿轮入口 + 移动端确认；⌘, 直达 settings 视图（已注册） |
| T5 全链路走查与联动 | 全局 | 默认模型 → 新会话生效；主题/语言/提供商状态实时刷新 |

## 5. 任务拆分（按 AGENT_PLAYBOOK 任务卡格式）

### TASK-S1-01 — 设置页「模型」分区
- **前置**：- ｜ **模块**：`src/features/settings/models/`、`src/features/models/`
- **范围**：`ModelsSection.tsx`、`sections.tsx`（注册 `models` 分区，置于 providers 之后）、i18n 键（en/zh）
- **规格**：分区内展示：当前服务器 provider 列表 + 已连接状态（复用 models store）；「默认模型」选择器——复用 `ModelPickerContent` 的选择 UI（搜索/分组/收藏/成本徽标），选中后写全局默认（store 新动作 `setDefaultModel(serverId, ref)`，持久化 `oc-default-model`，优先于 config 默认、低于会话显式选择）；说明文案"新会话默认使用此模型，可在输入框 chip 按会话覆盖"
- **验收**：打开设置 → 模型分区可达；选择默认模型后新建会话的 `activeModelFor` 解析到该模型；PromptBox chip 仍可覆盖
- **测试**：L1（store 新动作 + 解析链优先级）+ L2（ModelsSection 渲染/选择/持久化）
- **提交**：`feat(settings): default model section (TASK-S1-01)`

### TASK-S1-02 — 提供商「可添加」入口
- **前置**：TASK-S1-01 ｜ **模块**：`src/features/settings/providers/`
- **范围**：`ProviderKeys.tsx`（+`AddProvider.tsx` 视契约）
- **规格**：契约核实先行——若 `/config` 支持写入 providers（本地 command/env / 远程 URL），实现"添加"对话框（名称 + 本地/远程配置）→ `PATCH /config` → 重拉 provider 目录；若不支持，降级为引导文案（"在服务端 opencode.json 配置后此处自动出现"）+ 文档链接。已链接提供商保持现有 key/OAuth 管理不变
- **验收**：mock 上可添加 → 出现在列表并可配 key；或降级路径文案正确
- **测试**：L1（服务层 patch 组装）+ L2（添加对话框/降级文案）+ L3（契约）
- **提交**：`feat(settings): add provider entry (TASK-S1-02)`

### TASK-S1-03 — 设置入口增强
- **前置**：- ｜ **模块**：`src/shells/desktop/`、`src/shells/mobile/`
- **范围**：DesktopShell（标题栏或 Rail 底部齿轮，保持主区 tab bar 现有按钮亦可，取更显眼者）、MobileShell 设置 tab 校验、⌘, 直达（已注册，验证）
- **规格**：桌面至少两处可达（快捷键 + 可见按钮）；移动端设置 tab 直达各分区；不破坏既有测试
- **验收**：桌面/移动端均可 1 次点击进入设置；⌘, 打开设置视图
- **测试**：L2（入口渲染 + 导航）
- **提交**：`feat(settings): prominent settings entry (TASK-S1-03)`

### TASK-S1-04 — 联动走查与收尾
- **前置**：TASK-S1-01..03 ｜ **模块**：全局
- **范围**：默认模型 → 新会话；主题/语言/提供商状态跨服务器切换一致性；设置搜索覆盖新分区；a11y 抽查
- **规格**：走查清单（见验收）逐项执行并记录于本文件附录；修缺陷随走查 commit
- **验收**：新用户路径「设置 → 提供商已链接 → 选默认模型 → 切浅色 → 切中文」全通
- **测试**：既有 L1/L2 + E2E E01 扩展（如涉及）
- **提交**：`fix(settings): integration walkthrough fixes (TASK-S1-04)`

## 6. 验收标准（DoD）

- [ ] 桌面与移动端均能一键进入设置页
- [ ] 设置页可见「模型」分区，可选择全局默认模型；新会话按默认解析，chip 可覆盖
- [ ] 提供商分区展示已链接状态并可管理 key/OAuth；「添加」入口按契约可用或降级文案正确
- [ ] 颜色模式（dark/light/system + 强调色）与语言切换即时生效并持久化（重启保留）
- [ ] `pnpm verify` 11/11 全绿；新增功能有 L1/L2 测试

## 7. 工程规范（执行时强制）

- 每个任务一个 commit：`feat(settings): ... (TASK-S1-0N)`，Conventional Commits + 归因
- **每次 commit 前同步更新 `CHANGELOG.md` + `CHANGELOG-zh.md` 的 `[Unreleased]` 段**（双语同一变更，含 TASK 归因）
- 用户可见字符串一律走 i18n（en/zh 键集一致，`pnpm check:i18n`）
- 只改任务卡「范围」内文件；模块所有权冲突时停下汇报
- 验收走查结果记录到本文档附录

## 附录：走查记录（TASK-S1-04）

**执行环境**：Mock OpenCode Server（`pnpm mock:start --cors`）+ Playwright UI 探针（浏览器 Tauri shim + fetch 传输，与 E2E 装置同源），桌面形态逐项走查新用户路径。

**新用户路径结果**：

| 步骤 | 结果 |
| --- | --- |
| 添加服务器（Mock OpenCode Server） | ✅ 健康变绿、进入项目 |
| Rail 齿轮进入设置 | ✅ 一键直达设置中心 |
| 模型分区默认模型选择 | ✅ 展示配置默认（Default 徽标）；选择后 chip 变为「本地默认」；Clear 还原 |
| 主题切换浅色 | ✅ 即时生效，`data-theme` 翻转为 light |
| 语言切换中文 | ✅ 激活态正确，界面文案切为 zh |
| 添加服务商 "myllm" | ✅ 对话框打开/提交，PATCH /global/config 写入 `provider.myllm`；❌ 提交后 Providers 列表未见新行（见「发现与修复」） |

**发现与修复**：

- 提交「添加服务商」后新服务商未出现在 Providers 列表：`GET /provider` 返回的是**静态 fixture**（`tests/mock-server/routes.ts` 声明式路由），而真实 opencode server 会把配置中声明的 provider 加载进目录。客户端在添加后本就重拉目录（ProviderKeys → list → setProviders），因此纯 mock 侧对等性问题，客户端代码零改动。
- 修复（TASK-S1-04）：`GET /provider` 改为动态处理——以 fixture 目录为底，把 `PATCH /global/config`（TASK-S1-02）写入的 `globalConfig.provider` 条目合并进 `all`（合成 Provider：`name` 取 ProviderConfig.name 否则取 id、`source: "config"`、env/options 透传、`models: {}`——未配 key 显示「未连接」），保留 fixture 的 `default` 与 `connected`；self-test 新增断言（合并后新 id 出现、静态目录与 default/connected 保留），`pnpm mock:test` 160/160 通过。
- 走查确认 S1-01/02/03 已实现特性端到端可用（上表 ✅ 项），本任务仅修复上述 mock 对等性问题。
