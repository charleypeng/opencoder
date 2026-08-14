# 侧边栏导航重构规格：Workspace → Folder → Sessions（Sidebar Navigation Redesign Spec）

> 版本：v1.3 · 2026-08-13（v1.3：**已实施**——T1-T7 全部完成，代码 + 测试 + 审查落地，见 §9 实施记录。v1.2 按用户决策调整「打开文件夹」复用 DirectoryPickerDialog；v1.1 新增 hover 操作与浮层视觉规范）· 依据：WorkBuddy 客户端界面 + `docs/openapi_v1.18.11.json`（API 契约）+ `docs/ui-design.md`（设计令牌）。  
> 目标：把 opencoder 左侧栏从「项目下拉切换 + 时间分组会话树」重构为「空间(Workspace) → 文件夹(Folder) → 会话(Session)」三级导航；**子任务（subagent 子会话）从左侧栏移除**，改为在对话框附近的「任务面板」中展示。

---

## 1. 背景与目标

### 1.1 现状（问题）

当前左侧栏结构（`src/shells/desktop/DesktopShell.tsx` L974-1057）：

```
Sidebar (w-64)
├─ header：服务器名 + Back to servers
├─ tabs：Sessions | Files
├─ ProjectSwitcher ── 下拉菜单切换"当前工作目录"（含 最近项目/全部项目/➕ 添加目录）
└─ SessionList ── 按时间分组（Today/Yesterday/This Week/Earlier）+ 父子会话树
   └─ 子任务（parentID 非空的 subagent 会话）通过 chevron 展开显示在侧栏内
```

问题：

1. **目录切换是"当前一个目录"模式**：一次只能看一个目录的会话，跨目录会话要反复点下拉切换，无法总览。
2. **层级不直观**：WorkBuddy 的「空间 → 文件夹 → 会话」心智模型清晰；opencoder 用时间分组 + 树形子任务，两个概念混在一起。
3. **子任务占据侧栏**：subagent 子会话树与 Todo 都在侧栏/抽屉，信息密度低，不符合"子任务属于当前对话"的心智。

### 1.2 目标（参考 WorkBuddy）

```
Sidebar
├─ header：空间名（服务器名）
├─ tabs：Sessions | Files
├─ ➕ 新建会话 / 搜索
└─ Workspace 树（三级）：
   workspace（空间 = 当前服务器）
   ├─ 📁 folder（文件夹 = 工作目录，如 opencoder、hermes、daily…）
   │   ├─ 💬 session 1（该目录下的会话，仅根会话）
   │   ├─ 💬 session 2
   │   └─ …
   └─ 📁 folder 2
       └─ …
Main
└─ ChatView
   └─ 任务面板（对话框附近）：当前会话的 Todo + 子会话(children) 列表 ← 子任务的新家
```

**核心决策**：

- **Workspace（空间）** = 当前连接的 opencode 服务器。
- **Folder（文件夹）** = 服务器上的工作目录（directory）。
- **Session（会话）** = 该目录下的根会话（`parentID` 为空）。
- **子任务** = 当前会话的 children（`GET /session/{id}/children`）+ Todo（`GET /session/{id}/todo`），只出现在对话框附近的「任务面板」，侧栏不渲染。

---

## 2. 信息架构与 API 映射（已对照 `docs/openapi_v1.18.11.json` 核实）

| UI 层级            | 语义                                                          | API 数据源                                                                                                                               | 关键字段                                                                                       |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Workspace 空间** | 连接的 opencode 服务器（`src/stores/registry.ts` 的 activeServerId） | —（客户端上下文）                                                                                                                             | server.id / server.name                                                                    |
| **Folder 文件夹**   | 工作目录 directory                                              | `GET /project`（项目列表）→ `Project.worktree`；空目录兜底 `GET /project/{projectID}/directories`（`ProjectDirectories[]`，`{directory, strategy}`） | `Project: { id, worktree, name, icon, time }`                                              |
| **Session 会话**   | 目录下的根会话                                                     | `GET /session?roots=true`（全量根会话，客户端按 `Session.directory` 分组）                                                                          | `Session: { id, slug, title, directory, projectID, workspaceID, parentID, time, status… }` |
| **子任务**          | 当前会话的 children + todo                                       | `GET /session/{id}/children`、`GET /session/{id}/todo` + SSE `session.updated` / `todo.updated`                                        | `Session.parentID`、`Todo.status`                                                           |

### 2.1 关键 API 契约细节

**`GET /session`（session.list）** — 本次重构的主数据源：

- 参数：`directory`（可选，限定目录）、`workspace`（可选）、`scope=project`、`path`、**`roots`（boolean，只返回根会话，过滤全部子任务）**、`start` / `search` / `limit`（分页与搜索）。
- 返回：按最近更新排序的 `Session[]`（含 `directory` 字段 → 客户端分组依据）。
- **现状缺口**：`src/services/session.ts` 的 `list()` 只透传 `directory`，**未暴露 `roots` 参数** → 需要扩展。

**`GET /project`（project.list）**：

- 参数：`directory` / `workspace`（可选）。
- 返回：`Project[]`，`worktree` 即目录绝对路径；`name` 是项目名（可能为空，fallback 到 basename）；`icon` 可作文件夹图标。
- 用途：补齐"有项目记录但当前无会话"的空文件夹，让 folder 列表完整。

**`GET /project/{projectID}/directories`（project.directories）**：

- 返回 `ProjectDirectories[]`（`{ directory, strategy }`）——一个项目关联的多个本地目录。
- 用途：可选增强——一个项目映射多个 folder 时用；v1 先只用 `worktree`。

**`GET /session/{id}/children`**：直接子会话数组（现有 `sessionService.children()` 已包装）。

**`GET /session/{id}/todo`**：会话任务列表（现有 `todoService` 已包装，TodoPanel 在用）。

### 2.2 数据源决策（方案 A，推荐）

- **主数据**：`GET /session?roots=true`（一次拉全量根会话，客户端按 `directory` 分组）。
  - 优点：一次请求、天然过滤子任务、SSE 增量更新。
  - **副作用规避**：请求**不带** `directory` 参数，不会触发未打开目录的 instance bootstrap（见 §7 风险 R1，避免 /Volumes/Doc/utm 冷启动 60s+ 问题）；服务器只为已打开过的目录返回会话。
- **补充**：`GET /project` 拉取项目列表，为每个 folder 提供 `name`/`icon`，并补上空目录（有项目无会话）。
- **分组规则**：`session.directory` 相同 → 同一 folder；folder 排序按最近会话更新时间（活跃在前）；无 `directory` 的会话归入「未分类」。

---

## 3. UI 设计规范（视觉）

### 3.1 整体形态

- 沿用现有设计令牌（`docs/ui-design.md` / `src/styles/tokens.css`）：`--bg-base/elevated/sunken`、`--fg-primary/secondary/faint`、`--accent`、圆角、动效 `--dur-*`；暗色为默认。
- 紧凑密度（与现 SessionList 一致）：folder 行 `py-1.5`，session 行 `py-1.5`，字号 `text-sm`（标题）/ `text-xs`（辅助信息）。
- 移动端（MobileShell）v1 不改，仅桌面端。

### 3.2 层级样式（参考 WorkBuddy 截图）

```
──────────────────────────────────────
 空间：home ▾（服务器名，即 workspace 级）   ← header 已有，保留
 ──────────────────────────────────────
 [+ 新建会话]  [🔍 搜索会话…]
 ──────────────────────────────────────
 ▸ 📁 opencoder          （3） ●      ← Folder 行：文件夹图标 + 名称 + 会话数 + 状态点 + chevron
     💬 修复登录 bug           2分钟前 ⋯   ← Session 行：状态点 + 标题 + 相对时间 + ⋯ 菜单
     💬 重构消息渲染           昨天
     💬 添加工作目录卡住排查    今天
 ▾ 📁 hermes  [📂][🗑]        （2）        ← Folder 行 hover：右侧浮现 打开文件夹/从列表移除
     💬 系统通知定时任务完成    31分钟前
     💬 检查远程API运行状态    今天
 ▸ 📁 daily             （0）          ← 空 folder：无会话，来自 /project
 ──────────────────────────────────────
```

- **Folder 行**：`📁` 文件夹图标（`--fg-secondary`）+ 名称（`basename(directory)`，有 `project.name` 用项目名）+ 右侧会话数（`text-fg-faint` 小号）+ 状态点 + chevron（`▸`/`▾`，`--fg-faint`）。hover：`bg-bg-sunken/50`，**并在右侧浮现快捷操作**（见 §3.4）。可折叠（状态持久化 localStorage，key `oc-workspace-folders-collapsed`）。
- **Folder 状态点**（参考 WorkBuddy 绿色圆点）：目录下存在 busy/retry 会话 → 显示 accent 色旋转点；存在 error → danger 红点；否则不显示。
- **Session 行**：复用现有 `SessionRow` 视觉（状态点 busy 旋转 / idle 灰点 / error 红点 + 标题 + 相对时间），**去掉** chevron、缩进连接线、fork 徽标（fork 徽标可保留，标识来源）；active 行 `bg-accent-soft`。
- **缩进**：folder 0 级（`pl-3`），session 1 级（`pl-3 + 20px`）。
- **分隔**：folder 之间用 4px 间距，不用分隔线；会话列表在 folder 下方紧凑排列。
- **滚动**：整树单滚动容器，folder 吸顶（`sticky top-0`，沿用现有 group header 样式）。


### 3.3 交互

- 点击 folder：展开/折叠；双击或展开时若无活动目录，**切换 current directory 并确保有会话**（复用 `ensureSessionInDirectory`）。
- 点击 session：`setActiveSession` + 若该 session 的 directory ≠ 当前目录，`setCurrent(directory)`（避免消息流串目录，DesktopShell 按 directory 重建 SSE）。
- 点击 folder chevron：仅展开/折叠，不切换目录（WorkBuddy 行为：展开看会话，点击标题行才切换）。
- 「＋ 新建会话」：在当前目录创建并打开（现有 `handleCreate` 逻辑迁移）。
- 「🔍 搜索」：过滤 folder 内的会话（现有 `matchesQuery` 逻辑迁移）；搜索时展开所有匹配 folder。
- **Folder 行 hover 快捷操作**（参考 WorkBuddy，见 §3.4.1）：鼠标悬浮在 folder 行 → 右侧浮现两个图标按钮，悬停或点击弹出对应操作：
  - 📂 **打开文件夹**（决策 2026-08-13：**直接打开已设计的 DirectoryPickerDialog**，初始定位到该 folder 目录，可在其中浏览子目录/确认添加）：`DirectoryPickerDialog` 新增 `initialDirectory` prop（默认 `/`），folder 行点击时传入 `folder.directory`，复用现有添加目录流程——不做 Finder 系统打开、不做独立 setCurrent 快捷（setCurrent 仍由 picker 确认时触发）。
  - 🗑 **从列表中移除**：把该目录从侧栏列表隐藏（本地持久化 `oc-workspace-hidden-folders`，仅客户端隐藏，**不删除服务器数据、不删会话**；与 recentProjects 的移除语义一致）。
  - 两个按钮在 folder 行 hover 时显示（`group-hover:opacity-100`），避免遮挡 chevron（按钮组置于 chevron 左侧或下方，spike 微调）。
- **Session 行 ⋯ 菜单增强**（参考 WorkBuddy §3.4.2）：在现有 ContextMenu（SessionList L465-494）基础上调整菜单项：
  - 新增「**打开文件夹**」：行为与 folder 行一致——打开 DirectoryPickerDialog 并**初始定位到 `session.directory`**（复用同一 `initialDirectory` 机制），浏览/确认后可切到该会话目录。
  - 现有「Fork / Share / Compress / Generate AGENTS.md / Rename / Delete」保留；Delete 项用 danger 红字（WorkBuddy 中删除项红色）。
  - 「批量操作」：WorkBuddy 有该入口；opencode 无批量删除 API → **v1 灰置占位**（disabled + tooltip「即将支持」），列入后续（决策 2026-08-13：确认灰置）。
  - 菜单浮层视觉按 §3.4.2。

### 3.4 操作浮层视觉规范（WorkBuddy 风格）

> 依据截图：`截屏2026-08-13 22.26.14.png`（folder 行浮层）、`截屏2026-08-13 22.26.43.png`（会话行菜单）。

#### 3.4.1 Folder 行快捷操作浮层

- **形态**：folder 行 hover 时，右侧浮现两个图标按钮（📂 打开文件夹 / 🗑 从列表中移除），图标 16px 线条风格（`--fg-secondary`），hover 变 `--fg-primary` 且底 `--bg-sunken`。
- **辅助信息**（WorkBuddy 截图右上角）：
  - 「打开文件夹」右上角绿色小圆点 = 该目录有活跃会话（busy）的状态点（复用 Folder 状态点）。
  - 「从列表中移除」右上角灰色小字 = 该目录最近会话的相对时间（`formatRelativeTime(recentMs)`，如「5分钟前」）。
- **浮层样式**：白/浅底（暗色主题 `--bg-elevated`）、1px 细边框（`--fg-faint/25`）、圆角 8px（`rounded-lg`）、轻阴影（`shadow-md`）；打开后出现在按钮下方/旁侧，2 个操作垂直排列，行高 32px，左图标 + 右文字，行 hover `--bg-sunken`。
- 实现建议：沿用项目现有 `ContextMenu` 组件（`src/components/ContextMenu.tsx`），配置 2 个 item；或更轻量的 `DropdownMenu`（Kobalte，ProjectSwitcher 已用）。

#### 3.4.2 Session 行操作菜单（⋯）

- **形态**：白/浅底（暗色 `--bg-elevated`）、1px 细边框（`--fg-faint/25`）、圆角 8px、轻阴影（`shadow-md`）；每项 32px 行高，**左 16px 线条图标 + 右文字**（`text-sm`）横向对齐，图标与文字间距 8px；行 hover `--bg-sunken`。
- **图标集**：批量操作 `☰`（三条横线）、打开文件夹 `📂`、重命名 `✎`、分享 `⇪`（外箭头）、删除 `🗑`；危险项（删除）文字 `--danger` 红。
- **分隔**：分组间用 1px `--bg-sunken` 分隔线（现有 ContextMenu 支持 separator）。
- **触发**：行 hover 显示 ⋯ 按钮（现有 `session-row-menu` 逻辑保留），点击/右键弹出；浮层 z-index 高于侧栏（`z-50`）。


---

## 4. 组件设计

### 4.1 新增组件

#### `src/features/sessions/workspaceTree.ts`（纯函数，T1 后置）

```ts
export interface WorkspaceFolder {
  directory: string;          // 工作目录绝对路径（folder 标识）
  name: string;               // basename(directory) 或 project.name
  project?: Project;          // 匹配的 Project（icon/name 来源）
  sessions: Session[];        // 该目录下的根会话（按 time.updated 倒序）
  recentMs: number;           // 最近会话时间（folder 排序用）
}
export interface WorkspaceTree {
  folders: WorkspaceFolder[]; // 按 recentMs 倒序
  uncategorized: Session[];   // 无 directory 的会话
}
export function buildWorkspaceTree(sessions: Session[], projects: Project[]): WorkspaceTree
```

- 过滤：仅 `parentID === undefined` 的会话进入树（roots 已在 API 层过滤，此处双保险）。
- 空 folder 来源：`projects` 中 `worktree` 不在任何 session.directory 里的项目。
- 纯函数，单测覆盖：分组、排序、空目录、未分类、重名 basename。

#### `src/features/sessions/WorkspaceTree.tsx`（新侧栏主体）

```ts
export interface WorkspaceTreeProps {
  serverId: string;
  onSelectSession: (sessionId: string) => void;
}
```

- 内部状态：`collapsed: Set<string>`（持久化）、`query: string`、`creating/error`、`hiddenFolders: Set<string>`（持久化，`oc-workspace-hidden-folders`）。
- 数据流：
  - `GET /session?roots=true`（新增 `sessionService.listRoots()`）→ `upsertSession` 批量入 store（复用现有 store）。
  - `GET /project` → `applyProjects`（复用现有 store）。
  - `createMemo(() => buildWorkspaceTree(storeSessions(), projects))` 响应式构建；渲染前过滤 `hiddenFolders`。
  - SSE：现有 `subscribeToServerEvents` 的 `session.updated` 已更新 store（注意 §7 R2 的 per-directory 范围问题）。
- 渲染：`WorkspaceFolderRow`（文件夹行 + hover 快捷操作 §3.4.1）+ 复用/简化 `SessionRow`（⋯ 菜单 §3.4.2）。
- Folder 行操作：
  - `打开文件夹` → 打开 `DirectoryPickerDialog`，`initialDirectory={folder.directory}`（从该目录开始浏览，复用添加目录流程；确认后 setCurrent 由 picker 既有 `add()` 逻辑完成）。
  - `从列表中移除` → 加入 `hiddenFolders` 并持久化。
- Session ⋯ 菜单：在现有 ContextMenu 基础上增「打开文件夹」（打开 picker，`initialDirectory={session.directory}`），Delete 项 danger 红字，「批量操作」灰置占位。
- 顶栏：`+ 新建会话` 按钮 + 搜索框（从 SessionList 迁移）。
- 空态：无任何 folder → 「暂无工作目录」+ 引导文案 + 「添加目录」按钮（打开 DirectoryPickerDialog）。

#### `src/features/sessions/SubtaskPanel.tsx`（对话框附近的子任务面板，替代/扩展 TodoPanel）

```ts
export interface SubtaskPanelProps {
  serverId: string;
  sessionId: string;
}
```

- 结构（在现有 Todo 抽屉 `aside` 内，DesktopShell L1439-1457 扩展）：
  - 「任务 Todo」区：现有 `TodoPanel` 逻辑（todo 图标 + 状态 + 优先级）。
  - 「子会话 Subtasks」区（新增）：`GET /session/{id}/children` 拉取 + SSE `session.updated` 增量；每行：状态点 + 标题 + 时间，点击 `setActiveSession` 跳转；空态「无子任务」。
  - 徽标数：Todo 数 + children 数。
- 定位：**对话框附近**——沿用现有右侧抽屉（DesktopShell 已实现 backdrop + 关闭按钮），后续可迭代为 ChatView 常驻侧栏。

### 4.2 修改组件

| 文件                                          | 改动                                                                                        | 说明                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/services/session.ts`                   | `list()` 增加 `roots?: boolean` 支持；新增 `listRoots(dir?)` 便捷方法                                | 透传 `query.roots`                                 |
| `src/features/sessions/DirectoryPickerDialog.tsx` | 新增 `initialDirectory?: string` prop（默认 `/`），打开时 `setDir(initialDirectory)` 并直接加载该目录列表 | 供 Folder/Session 行的「打开文件夹」复用；注意 §7 R6      |
| `src/features/sessions/SessionList.tsx`     | 会话行抽取复用；子任务树逻辑（chevron/children/`buildSessionTree`）迁出或保留给 SubtaskPanel                    | v1 建议**保留 SessionList 文件**供搜索/空态逻辑复用，DOM 结构改为扁平行 |
| `src/features/sessions/ProjectSwitcher.tsx` | 保留「添加目录」入口，迁入 WorkspaceTree 顶栏或 folder 区头部；下拉切换逻辑退役                                       | 「最近项目」列表合并进 folder 排序（活跃在前）                      |
| `src/features/sessions/TodoPanel.tsx`       | 复用为 SubtaskPanel 的 Todo 分区                                                                | 不改对外契约                                           |
| `src/shells/desktop/DesktopShell.tsx`       | 侧栏：`ProjectSwitcher + SessionList` → `WorkspaceTree`；Todo 抽屉 → `SubtaskPanel`（含 children） | L1028、L1054、L1455                                |
| `src/i18n/en.json` / `zh-CN.json`           | 新增 key：`workspace/empty/emptyHint`、`subtasks/subtasks/empty`、`uncategorized`、`openFolder` 等 | 成对新增，`pnpm check:i18n` 必须过                       |
| `CHANGELOG.md` / `CHANGELOG-zh.md`          | `[Unreleased]` 增补条目                                                                       | 与提交同 commit                                      |

### 4.3 数据流

```
打开服务器
 └─ WorkspaceTree mount
     ├─ GET /session?roots=true ──► session store（upsertSession）
     ├─ GET /project ────────────► project store（applyProjects）
     └─ createMemo(buildWorkspaceTree) ──► 渲染 folder→sessions
点击 folder（未展开时）
 └─ 若 directory ≠ current：setCurrent(directory) + ensureSessionInDirectory
点击 session
 └─ setActiveSession + setCurrent(session.directory)（若不同）→ ChatView 加载
SSE（当前目录）
 └─ session.updated / todo.updated ──► store ──► 树与任务面板实时刷新
打开 SubtaskPanel
 └─ GET /session/{id}/children（一次性补齐）+ GET /session/{id}/todo + SSE 增量
```

---

## 5. 实施任务分解（按序执行，每个任务含验收）

### T1 — session service 支持 roots（低）

- `src/services/session.ts`：`list(dir?, roots?)` 增加 `roots` 透传；新增 `listRoots(dir?)`。
- 验收：`pnpm test src/services/session.test.ts`；新加单测断言 `query.roots === "true"`。

### T2 — workspaceTree 纯函数（低）

- 新增 `src/features/sessions/workspaceTree.ts` + `workspaceTree.test.ts`。
- 验收：单测覆盖分组/排序/空目录/未分类/重名；`pnpm test src/features/sessions/workspaceTree.test.ts`。

### T3 — WorkspaceTree 组件（中，核心）

- 新增 `src/features/sessions/WorkspaceTree.tsx` + 测试；Folder 行 + Session 行 + 顶栏 + 空态 + 折叠持久化。
- **Folder 行 hover 快捷操作**（§3.4.1）：打开文件夹（打开 DirectoryPickerDialog 并 `initialDirectory` 定位到该目录）、从列表移除（hiddenFolders 持久化）；状态点（busy 旋转 / error 红）；时间小字。
- **DirectoryPickerDialog `initialDirectory` 支持**：新增 prop，打开即加载目标目录列表。
- **Session ⋯ 菜单增强**（§3.4.2）：ContextMenu 增「打开文件夹」（picker 定位到 session.directory）；Delete 项 danger 红字；「批量操作」灰置占位。
- 验收：L2 组件测试（渲染三级结构、点击切换、搜索过滤、折叠展开、folder hover 操作、隐藏目录、菜单项、picker 初始定位）；axe 无 serious 违规；`pnpm test src/features/sessions/WorkspaceTree.test.tsx`。

### T4 — DesktopShell 集成（中）

- 侧栏替换 `ProjectSwitcher + SessionList` → `WorkspaceTree`；保留 Files tab 不变。
- 「添加目录」入口迁移；`SessionList` 退役路径清理（若复用则瘦身）。
- 验收：手动冒烟——多目录会话分组正确、切换目录会话不串、SSE 实时刷新；`pnpm test:e2e`（会话相关用例）。

### T5 — SubtaskPanel（中）

- 新增 `src/features/sessions/SubtaskPanel.tsx`（Todo 区复用 TodoPanel + children 区）+ 测试。
- DesktopShell Todo 抽屉扩展为 SubtaskPanel。
- 验收：children 拉取/增量/点击跳转；todo 与 children 徽标数正确；L2 测试通过。

### T6 — i18n + CHANGELOG（低，随各任务走）

- 每任务涉及的用户可见字符串成对加入 en/zh-CN；`pnpm check:i18n` 过。
- 每个 feat/fix 同步更新双 CHANGELOG（`[Unreleased]`，带 `type(scope):` + 归因）。

### T7 — 全量门禁（收尾）

- `pnpm verify`（11/11）全过；`pnpm test:coverage` 阈值达标；`pnpm test:e2e` 会话/侧栏用例过。

---

## 6. 测试计划

| 层级                     | 用例                                                                         |
| ---------------------- | -------------------------------------------------------------------------- |
| L1 单测（workspaceTree）   | 分组正确性；parentID 过滤；空目录补全；未分类；排序；basename 重名（`/a/blog` vs `/b/blog`）         |
| L1 单测（session service） | `roots` 参数透传                                                               |
| L2 组件（WorkspaceTree）   | 渲染 folder→sessions；展开/折叠；搜索过滤；点击切换回调；空态引导；折叠状态持久化；**folder hover 操作（打开/移除）**；**隐藏目录持久化**；**状态点（busy/error）**；**「打开文件夹」→ picker 初始定位** |
| L2 组件（DirectoryPicker）  | `initialDirectory` 打开即加载目标目录；缺省回退 `/`                                                        |
| L2 组件（SubtaskPanel）    | children 拉取与 SSE 增量；todo 渲染；点击跳转；空态                                        |
| L2 组件（菜单浮层）          | Folder/Session 浮层项渲染与点击；Delete 红字；「批量操作」灰置不可点；Esc/外部点击关闭                          |
| L3 契约（mock:test）       | `GET /session?roots=true` 响应形状；`GET /project`；`GET /session/{id}/children` |
| E2E                    | 打开服务器 → 侧栏见多目录分组 → 切换目录 → 会话不串 → 子任务仅出现在任务面板 → hover folder 出现操作浮层       |

---

## 7. 风险与待验证项

- **R1 冷启动（高，已实证）**：请求带新 `directory` 会触发服务器 instance bootstrap（`/Volumes/Doc/utm` 曾耗时 64s）。→ 设计已规避：树主数据 `GET /session?roots=true` **不带** directory；新增目录仍走「添加目录」弹窗（保持现状与已知限制）。
- **R2 SSE 范围（高，需 spike）**：现有 `subscribeToServerEvents`（`src/stores/events.ts` L364 `directoryProvider`）是 **per-directory** 流——当前目录的会话实时，**其他目录的会话变化需要切换目录或手动同步**。→ spike：验证服务器是否支持全局事件流；若不支持，WorkspaceTree 在「展开 folder」与「切换目录」时补一次 `listRoots()` 同步，并接受跨目录非实时（标注为已知限制）。
- **R3 性能**：目录多/会话多时全量 `listRoots()` 体量。→ 现有分页参数 `start/limit` 预留；v1 接受全量（与现 SessionList 同级），超阈值后再做虚拟滚动（`SessionList` 注释已预留）。
- **R4 兼容**：老会话无 `directory` → 归「未分类」folder；`parentID` 环（已由现有 `buildSessionTree` 的 depth 上限防御）不再适用于扁平列表，无环风险。
- **R5 文件所有权**：严格按 §4.2 表格划分，越界停下汇报（遵守 `docs/AGENT_PLAYBOOK.md` §4 ownership）。
- **R6 picker 初始目录冷启动（中）**：「打开文件夹」用 `initialDirectory` 让 DirectoryPickerDialog 直接加载目标目录——若该目录从未 bootstrap 过，会重现 R1 的冷启动等待（64s+）。→ 缓解：folder 均来自 `/project` + 会话分组（已打开过的目录，通常已 bootstrap）；picker 加载时保留现有「正在加载目录…」文案并增加超时提示（沿用已有 30s 超时错误展示）。**不做**系统 Finder opener（决策 2026-08-13）。

---

## 8. 分期里程碑

| 阶段     | 内容            | 交付                                                | 状态 |
| ------ | ------------- | ------------------------------------------------- | ---- |
| **M1** | T1 + T2（数据层）  | roots 参数 + workspaceTree 纯函数 + 测试                 | ✅ |
| **M2** | T3 + T4（侧栏重构） | WorkspaceTree 上线，替代 ProjectSwitcher + SessionList | ✅ |
| **M3** | T5 + T6（任务面板） | SubtaskPanel（todo + children）在对话框附近上线             | ✅ |
| **M4** | T7（收尾）        | verify 全绿 + CHANGELOG + 发布                        | ✅（L1 vitest 全过，2155/2155） |

---

## 9. 实施记录（2026-08-13，分支 `feat/workspace-tree-nav`）

**交付物**：
- `src/services/session.ts`：`list(dir?, roots?)` 支持 roots 参数 + `listRoots(dir?)` 便捷方法
- `src/features/sessions/workspaceTreeUtils.ts`：`basename` / `buildWorkspaceTree` 纯函数（分组/排序/空目录/未分类/重名消歧）
- `src/features/sessions/DirectoryPickerDialog.tsx`：新增 `initialDirectory` prop（打开即定位到目标目录）
- `src/features/sessions/WorkspaceTree.tsx`：核心侧栏组件（folder→sessions 三级树 + 折叠持久化 + 搜索 + 状态点 + folder hover 操作 + session ⋯ 菜单增强 + 空态）
- `src/features/sessions/SubtaskPanel.tsx`：任务抽屉（TodoPanel 复用 + children 子会话区）
- `src/shells/desktop/DesktopShell.tsx`：侧栏替换 ProjectSwitcher + SessionList → WorkspaceTree；Todo 抽屉 → SubtaskPanel
- i18n（en/zh-CN 成对新增）+ 双 CHANGELOG 更新

**测试**：新增/改写 31 个用例（workspaceTreeUtils 9、WorkspaceTree 13、SubtaskPanel 5、DirectoryPicker 3、session service 4）；DesktopShell 85 用例适配新语义（3 个 project-switcher 用例改为「点击跨目录会话切换」、fork 用例断言 child 不进树）。L1 vitest 全量 **2155 通过 / 0 失败**。

**审查修复**（审查 agent + 自查）：
1. 折叠按钮 onClick 未 stopPropagation（与行 toggle 抵消）→ 加 stopPropagation
2. refresh() 无请求序号（旧响应覆盖新快照）→ refreshSeq 守卫
3. 隐藏目录不可恢复 → current 变化时自动从 hiddenFolders 移除
4. SessionRow 键盘不可达 → tabindex/role/aria-label/focus 样式
5. 自动进入目录用了未过滤列表 → visibleFolders()

**关键踩坑**：
- macOS 大小写不敏感 FS：`WorkspaceTree.tsx` 与 `workspaceTree.ts` 解析冲突 → 纯函数改名 `workspaceTreeUtils.ts`
- SolidJS `setStore(path, obj)` 是**合并**语义 → upsertLocal 用 `produce` 整体替换（否则 unshare 后 share 字段残留）
- invoke payload 的 query 值是**原始 JS 值**（boolean `true`）→ mock 匹配 `=== true`（类型放宽 `Record<string, string | boolean>`）

**已知限制（后续迭代）**：
- SSE 为 per-directory（R2）：跨目录会话变化在展开/切换时 `refresh()` 补拉
- 「批量操作」灰置占位（无批量 API）
- 子任务面板当前为右侧抽屉，后续可迭代为 ChatView 常驻侧栏

---

## 10. 追加：默认工作区引导（2026-08-14，feat/default-workspace）

**需求**：初次添加 opencode 服务器并点击进入时，弹出「默认工作区」提示对话框；用户经 directory picker 选好路径后按所选路径进入主页面；设置里可重新设置该服务器的默认工作区。

**实现**：
- `src/features/servers/defaultWorkspace.ts`：per-server 默认工作区持久化（localStorage `oc-default-workspace:<serverId>`）+ `hasWorkspaceHistory`（默认工作区或最近目录任有即视为有历史）+ `wasDefaultWorkspacePrompted`/`markDefaultWorkspacePrompted`（跳过不打扰）
- `src/features/sessions/DefaultWorkspaceDialog.tsx`：引导对话框 = DirectoryPickerDialog 的引导变体（自定义 title/hint + 「跳过」按钮），`onAdded` 里 `setDefaultWorkspace` 持久化（进入由 picker 的 add 流程完成：setCurrent + ensureSessionInDirectory）
- `DirectoryPickerDialog.tsx` 新增 props：`title`/`hint`（覆盖默认文案）、`showSkip`/`onSkip`（引导跳过）、`onAdded(directory)`（add 成功回调）
- `DesktopShell` onMount：`!hasWorkspaceHistory && !wasPrompted` → 弹引导（markPrompted 防反复打扰）
- `ServersSection` 每行新增「默认工作区」：显示当前值（未设置灰字）+「修改默认工作区」→ picker（initialDirectory=当前默认）→ onAdded 保存 + 响应式刷新（localStorage 读取非响应式，组件内 `workspaceOf` 缓存 map）

**测试**：defaultWorkspace store 8 用例、DefaultWorkspaceDialog 3、DirectoryPicker onAdded 1、ServersSection 默认工作区 2、DesktopShell 引导 3（首入弹/已有默认不弹/跳过不再弹）。

---

## 11. 追加：工作区布局重构（2026-08-14，feat/workspace-tree-nav）

**需求**：① 默认工作区置顶 + 视觉区分 + 分割线；② new session 在默认工作区创建；③ new session 下方新增「添加工作区」按钮（picker）；④ 工作区悬浮按钮：+（该目录新建 session）、⋯（菜单：查看文件夹 / 移除此工作区）；⑤ 全部用户更改（工作区增删、session 创建、默认工作区标记）本地持久化。

**实现**：
- `src/features/sessions/workspaces.ts`：**显式工作区列表**（localStorage `oc-workspaces:<serverId>`）——picker 添加的目录即使无会话/无 project 也持续显示（解决「添加的工作区重启后消失」的持久化缺口）；移除同步删除列表项
- `WorkspaceTree.tsx`：
  - 默认工作区（readDefaultWorkspace）→ `defaultFolder`/`otherFolders` 分组渲染：默认行 `data-default` + 「默认」徽标 + `workspace-divider` 分割线
  - `handleCreate`（header new session）→ `createSession(..., defaultWorkspace ?? undefined)` 在默认工作区创建；新增 `handleCreateIn(directory)`（folder [+]）
  - header 新增「+ 添加工作区」按钮（`workspace-add-workspace`）→ 打开 picker，`onAdded` 写入显式列表
  - FolderRow hover 按钮重构：`[+]`（workspace-folder-add）+ `[⋯]`（workspace-folder-more）替代原 open/remove；⋯ 菜单（folderMenuItems）= 查看文件夹（`onViewFolder` 回调）/ 移除此工作区（danger，removeFolder + dropWorkspace）
  - 移除 folder 行原「打开文件夹 picker」入口（该能力保留在会话 ⋯ 菜单）
- `DesktopShell.tsx`：`onViewFolder` → `setCurrent + pushRecentProject + setMainView("files")`（查看文件夹跳到 Files 视图展示该目录文件）

**测试**：workspaces store 6 用例；WorkspaceTree +10（默认置顶徽标/分割线、添加工作区按钮、默认创建、[+] 创建、⋯ 菜单查看/移除、显式列表持久化渲染、移除清列表）；DesktopShell +1（查看文件夹 → Files 视图 + 目录切换）；改写 2 个旧用例（remove/picker 定位 → ⋯ 菜单）。

---

## 附：参考截图描述（WorkBuddy）

**`截屏2026-08-13 22.16.34.png`（整体布局）**：
- 左侧栏：顶部窗口控制 + 版本号；导航（新建任务/助理/项目/专家技能/自动化/资料库/更多）；下方「任务(9)」「空间(9)」两个可折叠分组。
- 「空间」分组下为文件夹（项目名：opencoder、hermes、daily…），每个文件夹下缩进列出会话（标题 + 相对时间），**子任务直接作为会话的子级列出**（本次重构要移除的行为）。
- 浅色主题、圆角、紧凑密度、文件夹图标 + 会话状态点。

**`截屏2026-08-13 22.26.14.png`（Folder 行 hover 操作）**：
- 悬浮「ihermes」文件夹行 → 右侧浮出操作浮层：「打开文件夹」（文件夹图标 + 文字 + 右上角绿色状态点）、「从列表中移除」（垃圾桶图标 + 文字 + 右上角灰色小字时间「5分钟前」）。
- 浮层：白底、浅灰细边框、小圆角、轻阴影；图标+文字左对齐；行 hover 浅灰高亮。

**`截屏2026-08-13 22.26.43.png`（Session 行操作菜单）**：
- 悬浮「分享任务」菜单项（浅灰高亮态）→ 浮层含 5 项：「批量操作」（☰）、「打开文件夹」（📂）、「重命名」（✎）、「分享任务」（⇪）、「删除任务」（🗑，**红色文字**）。
- 浮层：白底、浅灰细边框、小圆角、轻阴影；每项左图标 + 右文字横向对齐、行高统一；危险项红色。
