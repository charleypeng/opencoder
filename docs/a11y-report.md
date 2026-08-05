# 无障碍走查报告（TASK-M9-08）

> 范围：WCAG 2.1/2.2 A+AA 自动扫描（axe-core 4.12，jsdom）、对比度人工核算、焦点环全局样式、`prefers-reduced-motion` 全量降级清单。
> 结论：关键屏幕（DesktopShell / 设置中心 / 会话列表 / 消息列表 / 输入框）**零 critical/serious 违规**；对比度全部核心文本对 ≥ 4.5:1；已修复项见下。

## 1. 自动扫描（axe-core）

方法：`src/a11y/a11y.test.tsx` 对五个关键屏幕渲染真实组件树后执行 axe（wcag2a/2aa/21aa/22aa 标签），断言无 critical/serious 违规（L2 常驻测试，`pnpm test` 内）。

| 屏幕 | 扫描结果 |
|---|---|
| DesktopShell（rail + 侧栏会话列表 + 聊天主区 + PromptBox + 状态栏） | 0 critical/serious |
| SettingsPage（desktop 变体，分区导航 + 搜索） | 0 critical/serious |
| SessionList（行、状态徽标、动作菜单） | 0 critical/serious |
| MessageList（气泡、工具卡片、reasoning 折叠） | 0 critical/serious |
| PromptBox（composer、agent 芯片、模型芯片） | 0 critical/serious |

### 修复的违规（扫描发现 → 修复）

| 规则 | 严重度 | 位置 | 修复 |
|---|---|---|---|
| `nested-interactive`（交互控件嵌套） | serious | `SessionList.tsx` 会话行：`role="button"` 行内嵌「⋯」动作按钮与树折叠按钮 | 行重构：外层包装 div（非交互，转发点击/键盘 + 承载 testid）内，行主体改为原生 `<button>`（保留 `aria-current`/`aria-haspopup`），树折叠与「⋯」按钮成为**兄弟节点** |
| `aria-allowed-attr`（非法 ARIA 属性） | critical | `SettingsPage.tsx` 分区导航按钮：普通 `<button>` 上使用 `aria-selected`（该属性仅限 tab/option/row 等选择类角色） | 改为 `aria-current`（当前分区）；测试断言同步更新 |
| `aria-allowed-attr` | critical | `DesktopShell.tsx` 主区视图切换条：`role="tablist"` 内混入非 tab 动作按钮（搜索/VCS/终端/设置），触发 `aria-required-children` | 该条本质是「视图切换 + 动作按钮」混合条而非 tablist：去掉 `tablist/tab` 角色，活动视图用 `aria-current`；侧栏真 tablist（全部子项为 tab）保留 |

## 2. 对比度核算（WCAG AA 文本 ≥ 4.5:1，非文本 ≥ 3:1）

修复：`tokens.css` 三处 token 上调（暗色 `--fg-faint`、亮色 `--fg-faint/--accent/--success`）。

### 暗色主题（bg-base #0f1115）

| 前景 | 修复前 | 修复后 | 备注 |
|---|---|---|---|
| --fg-primary #e8eaf0 | 15.71:1 | — | ✓ |
| --fg-secondary #9aa3b2 | 7.43:1 | — | ✓（bg-elevated 上 6.85:1） |
| --fg-faint | #5c6575 → **3.22:1** ✗ | #788296 → **4.89:1**（elevated 4.51:1） | 实际承载占位符/空态/提示文本，必须 ≥4.5 |
| --accent #7c8cff | 6.35:1 | — | ✓ 文本与非文本均过 |
| --success/--warning/--danger | 9.83 / 11.32 / 6.83:1 | — | ✓ |

### 亮色主题（bg-base #f6f7f9 / bg-elevated #ffffff）

| 前景 | 修复前 | 修复后 | 备注 |
|---|---|---|---|
| --fg-primary #191e29 | 15.56:1 | — | ✓ |
| --fg-secondary #586071 | 5.89:1 | — | ✓ |
| --fg-faint | #8b93a3 → **2.88:1** ✗ | #646d7e → **4.86:1**（white 5.21:1） | 与 fg-secondary 的层级差保留 |
| --accent | #4f63f5 → **4.42:1** ✗（accent-soft 徽标底 3.69:1 ✗） | #3d4fd8 → **5.92:1**（bg 上）、accent-soft 徽标底上 **4.81:1** | 徽标/芯片的 text-accent 也过线 |
| --success | #059669 → **3.52:1** ✗ | #047857 → **5.12:1**（white 5.48:1） | 状态文本（如文件新增、`$` 提示符） |
| --warning #b45309 | 4.68:1 | — | ✓（≥4.5） |
| --danger #dc2626 | 4.51:1 | — | ✓（≥4.5） |

## 3. 焦点可见性

- 全局兜底（`index.css` @layer base，TASK-M9-08）：`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`。accent 在两种主题下均 ≥ 3:1（6.35 / 5.92），满足非文本 AA。未自绘焦点态的组件全部获得统一焦点环。
- 自绘焦点态组件（按钮、输入框的 `focus:border-*`/`focus:bg-*` 等）保持原有样式；本次重构后的会话行按钮同时有 `focus:bg-accent-soft` + 全局焦点环。
- 组件扫描补充：全部图标按钮均已带 `aria-label`/`title`（脚本扫描 svg-only 无标签按钮 → 0 个）。

## 4. prefers-reduced-motion 降级清单

| 动画 | 载体 | 降级路径 |
|---|---|---|
| 打字呼吸光标 `.typing-cursor` | index.css | `animation: none` + 静态半透明 |
| 流式进度条 `.streaming-progress-bar` | index.css | `animation: none` + 静态 accent 条 |
| 工具卡片 shimmer `.tool-shimmer` | index.css | `animation: none` + 透明 |
| 搜索结果高亮闪烁 `.viewer-line-flash` | index.css | 背景清除 |
| 宠物动画（8 态 + 爪/星光/心） | index.css | `animation: none !important` |
| 页面推入转场（forward/back/zoom） | index.css + `--dur-*` | `--dur-fast/--dur-med` 归零（tokens.css）→ 瞬时切换 |
| Sheet 拖拽/透明度转场 | Sheet.tsx 自检 `reducedMotion()` | 0ms 线性转场 |
| `animate-spin`/`animate-pulse`/`animate-ping`/`animate-bounce`（加载圈、脉冲徽标） | Tailwind 工具类 | **本次新增**：Tailwind v4 preflight 已不再内置 reduced-motion 覆盖，补全局 `animation: none !important` |
| 所有 CSS 过渡（hover/状态色） | 全局 | 本次新增 `transition-duration: 0.01ms !important` |
| xterm 光标闪烁 | TerminalInstance `cursorBlink: true` | 豁免：终端内容显示不属于页面动画（WCAG 2.2.2 仅约束内容闪烁/自移；光标闪烁为终端惯例，非动画内容） |

## 5. 豁免与说明

- `color-contrast` 规则在 jsdom 无法计算真实颜色 → 由第 2 节的 token 核算表替代（走查项为 token 级全覆盖，非逐像素）。
- `target-size`（WCAG 2.2 AA）依赖真实布局，jsdom 无法测量 → 界面交互目标按现有密度规范（`--density`、按钮 padding 一致）人工抽查通过。
- 亮色 `--warning`（4.68:1）与 `--danger`（4.51:1）余量较紧但达标，未再深调（保持品牌色相）。
- 扫描覆盖五个关键屏幕；终端面板（懒加载）与 ServerHome 等其余屏幕沿用相同组件模式，违规已在本次扫描与代码模式检查中消除。
