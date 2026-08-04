# 子 Agent 执行手册（Agent Playbook）

> 本文件定义实施阶段如何把任务派发给子 agent 执行。主 agent（或用户）按里程碑顺序派发；子 agent 每次只领一张任务卡。

---

## 1. 任务卡格式

每个任务卡包含以下字段（见 `docs/tasks/M*.md`）：

| 字段 | 含义 |
|---|---|
| **ID** | `TASK-M<x>-<nn>`，全局唯一 |
| **标题** | 一句话目标 |
| **前置** | 必须先完成的任务 ID（无则标 `-`） |
| **模块** | 代码所有权（决定并行安全性，见 §4） |
| **范围** | 允许新建/修改的目录与文件 |
| **API** | 涉及的 OpenAPI 端点（对照 `docs/api-coverage.md` 与 `docs/openapi_v1.18.11.json`） |
| **规格** | 实现要点（关键行为、边界条件、设计约束） |
| **验收** | 可勾选的行为标准 |
| **测试** | 必须新增的测试（层级按 `docs/testing.md` §5 纪律） |
| **提交** | Conventional Commit 消息 + CHANGELOG 条目要求 |

## 2. 子 Agent 执行循环（硬性流程）

```
1. 读取        任务卡 + PLAN/架构/设计相关章节 + 涉及模块的现有代码
2. 确认前置    前置任务已完成（git log 可见对应 commit）；不满足 → 停止并汇报
3. 实现        仅在「范围」内写代码；i18n：用户可见字符串一律新增 i18n key（en + zh-CN）
4. 测试        按「测试」字段补测试；运行 pnpm verify（L0+L1+L2+L3）必须全绿
5. Changelog   CHANGELOG.md 与 CHANGELOG-zh.md 的 [Unreleased] 段各加一条
6. Commit      一个任务一个 commit，消息格式见 §3
7. 汇报        输出：完成情况 / 测试结果 / commit hash / 遗留问题或偏差
```

**禁止事项**：
- 超出「范围」修改其他模块文件（确有需要 → 停下来汇报，由派发方协调）
- 跳过测试或把失败测试标记 skip 蒙混过关
- 一个 commit 混入多个任务的内容
- 编造 API 行为：一切以 `docs/openapi_v1.18.11.json` 为准；不确定时查 https://opencode.ai/docs/ 或向派发方提问

## 3. Commit 与 Changelog 规范

```bash
# 格式
git checkout -b task/M2-03-session-list     # 任务分支
git commit -m "feat(sessions): 会话列表分组与状态徽标 (TASK-M2-03)"
```

| 类型 | 场景 |
|---|---|
| `feat` | 新功能（必须双 Changelog 条目） |
| `fix` | 缺陷修复（先写复现测试） |
| `test` | 纯测试补充 |
| `chore` | 基建/依赖/配置 |
| `docs` | 文档 |
| `refactor` | 无行为变化的重构 |

CHANGELOG（Keep a Changelog，`[Unreleased]` → `Added/Changed/Fixed`）：

```markdown
<!-- CHANGELOG.md -->
### Added
- Session list with time grouping and status badges (TASK-M2-03)

<!-- CHANGELOG-zh.md -->
### 新增
- 会话列表支持时间分组与状态徽标 (TASK-M2-03)
```

## 4. 模块所有权表（并行安全）

| 模块目录 | 可并行的里程碑任务 |
|---|---|
| `src-tauri/src/connections/`、`src/features/servers/` | M1 |
| `src/services/*`、`src/stores/*` | M1–M2 串行（地基），M3+ 按文件拆分可并行 |
| `src/features/sessions/`、`src/features/messages/` | M2–M3 |
| `src/features/files/`、`src/features/vcs/` | M4（与 M3 可并行） |
| `src/features/permissions/`、`questions/`、`commands/`、`models/` | M5（与 M4 可并行） |
| `src/features/terminal/` | M6（与 M5 可并行） |
| `src/shells/mobile/`、`src-tauri/plugins/glass/` | M7 |
| `src/shells/desktop/`、`src/features/pet/`、`src-tauri/src/pet/` | M8（与 M7 可并行） |
| `src/i18n/`、`src/features/settings/` | M9 |
| `tests/mock-server/` | M0 完成后冻结接口，变更需评审 |

**规则**：同一时刻同一模块目录只派一个子 agent；跨模块任务（改 `services` + 某 feature）串行派发。

## 5. 派发 Prompt 模板

```text
你是 opencoder 项目的实施工程师。请完成任务 TASK-M2-03。

必读上下文（按顺序阅读）：
- docs/PLAN.md §8（工程规范）
- docs/AGENT_PLAYBOOK.md（执行循环，硬性）
- docs/tasks/M2.md 中 TASK-M2-03 任务卡
- docs/architecture.md §4-§5（服务层与状态层）
- docs/api-coverage.md 中任务卡列出的端点
- docs/openapi_v1.18.11.json 中对应端点的 schema（用脚本查询，勿全文阅读）

工作目录：<repo 根目录>
约束：
- 只改任务卡「范围」内的文件
- 用户可见字符串必须走 i18n（en + zh-CN 双写）
- 完成后运行 pnpm verify 并保证全绿
- 按 AGENT_PLAYBOOK §2 流程：测试 → 双 Changelog → commit → 汇报

汇报格式：
## 完成内容 / ## 测试结果（verify 输出摘要）/ ## Commit（hash + message）/ ## 偏差与遗留
```

## 6. Review Gate（里程碑出口）

每个里程碑结束后，由主 agent + 用户共同验收：

1. 该里程碑全部任务卡 commit 齐全、CI 绿
2. 出口标准（PLAN §5 表格 DoD 列）逐条演示确认
3. CHANGELOG `[Unreleased]` 归集为该里程碑版本段（如 `## [0.2.0] - 日期`）
4. 用户确认 → 打 tag → 进入下一里程碑
