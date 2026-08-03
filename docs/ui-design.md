# UI / UX 设计规范

> 配套文档：`docs/PLAN.md` · 状态：DRAFT 待审阅
> 关键词：Desktop = 简洁高效现代化 · Mobile = 精致简洁 + 高级细节特效 + iOS 26 Liquid Glass

---

## 1. 设计原则

| # | 原则 | 落地 |
|---|---|---|
| 1 | **内容为王， chrome 让位** | 聊天内容区占视野 ≥ 70%；工具栏低密度、可隐藏 |
| 2 | **键盘可达一切（桌面）** | 所有操作有快捷键；⌘K 命令面板兜底 |
| 3 | **拇指可达一切（移动）** | 核心操作集中在下 1/3 屏；顶部仅放导航与状态 |
| 4 | **流式优先** | token 到达即渲染，不等待完整消息；工具调用过程透明展开 |
| 5 | **状态诚实** | 连接/生成/权限等待状态永远可见，绝不假死 |
| 6 | **平台归属感** | 遵守 macOS/Windows/iOS/Android 各自惯例（字体、圆角、动效曲线、安全区） |

## 2. 设计令牌（`src/styles/tokens.css`）

以 CSS Variables 定义，Tailwind v4 `@theme` 桥接，深浅色双主题 + 平台微调：

```css
:root {
  /* 色彩语义（示例值，实施时定稿） */
  --bg-base: #0f1115;        --bg-elevated: #161a22;    --bg-sunken: #0a0c10;
  --fg-primary: #e8eaf0;     --fg-secondary: #9aa3b2;   --fg-faint: #5c6575;
  --accent: #7c8cff;         --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --success: #34d399; --warning: #fbbf24; --danger: #f87171;
  /* 玻璃材质（移动端/floating 元素） */
  --glass-bg: rgba(22, 26, 34, 0.62);
  --glass-border: rgba(255, 255, 255, 0.09);
  --glass-blur: 24px;
  /* 字阶 */ --text-xs: 11px; --text-sm: 13px; --text-md: 14px; --text-lg: 17px;
  /* 圆角 */ --r-sm: 6px; --r-md: 10px; --r-lg: 16px; --r-xl: 22px;   /* iOS 更大 */
  /* 动效 */ --ease-spring: cubic-bezier(0.32, 0.72, 0.24, 1); --dur-fast: 120ms; --dur-med: 220ms;
  /* 密度 */ --density: 1;   /* 桌面紧凑 0.92，移动 1.06 */
}
[data-theme="light"] { … }
```

- **字体**：UI 用系统栈（SF Pro / Segoe UI Variable / Inter / Roboto 自动匹配）；代码用 JetBrains Mono / SF Mono
- **移动端字号上调 1px**、触控目标 ≥ 44×44pt（iOS HIG）/ 48×48dp（Material）

## 3. Desktop 形态（简洁高效现代化）

### 3.1 布局（三栏，均可折叠）

```
┌────────────────────────────────────────────────────────────┐
│ TitleBar(自定义, 交通灯/最小化内嵌)   ⌘K     🔔  ⚙  🐾 │
├────────┬──────────────────┬────────────────────────────────┤
│ Rail   │ Sidebar          │ Main                           │
│ 56px   │ 240-320px        │                                │
│ ┌────┐ │ ┌──────────────┐ │  ┌──────────────────────────┐  │
│ │服务器││ │ 项目/文件夹    │ │  │  Chat / Files / Terminal │  │
│ │图标列││ │ ──────────── │ │  │  (Tab 切换, 拖拽分栏可选) │  │
│ │ +  │ │ │ 会话列表      │ │  │                          │  │
│ └────┘ │ │  (搜索/分组)   │ │  │                          │  │
│        │ └──────────────┘ │  ├──────────────────────────┤  │
│        │                  │  │ PromptBox (含 agent/model │  │
│        │                  │  │  选择、附件、token 指示)  │  │
└────────┴──────────────────┴──┴──────────────────────────┴──┘
│ StatusBar: server●  project/branch  LSP●  MCP  tokens/$      │
```

- **Rail（最左）**：服务器图标列 + 健康状态点 + “+”添加；点击切换服务器（键盘 ⌘1…⌘9 直选）
- **Sidebar**：上段项目/文件夹切换器（下拉 + 最近），下段会话列表（按时间分组、状态徽标、hover 出现改名/删除）
- **Main**：Chat 为主；Files/Terminal 以 Tab 或右侧分栏并存
- **密度**：默认紧凑密度（`--density: 0.92`），行高收敛，信息量大但留白节奏不乱

### 3.2 桌面交互规范

| 交互 | 规范 |
|---|---|
| 快捷键 | 见 §3.3 快捷键表；全部可自定义（设置页） |
| 右键菜单 | 会话项（改名/分叉/分享/回滚/删除）、消息（复制/重新生成/删除/查看 diff）、文件（打开/复制路径/在会话中引用）、选中文本（复制/引用到输入框） |
| 命令面板 ⌘K | 模糊搜索：会话、文件(`/find/file`)、符号、命令、设置项、服务器 |
| 拖拽 | 文件 → PromptBox 生成 FilePart 附件；会话 → 服务器图标（预留跨服务器迁移，Backlog） |
| 多窗口 | 次级窗口承载：diff 全屏、终端独立窗、设置（预留，M8 评估） |
| 窗口 | 自定义 TitleBar 内嵌窗口控制；macOS 红绿灯融合；Windows  snap layout 兼容 |

### 3.3 默认快捷键表

| 键 | 功能 | 键 | 功能 |
|---|---|---|---|
| ⌘/Ctrl+K | 命令面板 | ⌘/Ctrl+N | 新会话 |
| ⌘/Ctrl+P | 快速打开文件 | ⌘/Ctrl+Shift+F | 全文搜索 |
| ⌘/Ctrl+1..9 | 切换服务器 | ⌘/Ctrl+[ / ] | 上/下一个会话 |
| ⌘/Ctrl+Enter | 发送 | Esc | 中断生成 / 关闭弹层 |
| ⌘/Ctrl+B | 侧栏开关 | ⌘/Ctrl+J | 终端面板开关 |
| ⌘/Ctrl+D | 会话 diff | ⌘/Ctrl+, | 设置 |
| Tab（输入框） | 切换 agent（build/plan） | ↑（空输入框） | 上一条 prompt |

## 4. Mobile 形态（精致简洁 + 高级特效）

### 4.1 布局与导航

```
┌─────────────────────────┐
│ 服务器导航页(首页)         │  ← App 启动落点：服务器卡片网格
├─────────────────────────┤
│ 进入服务器后：底部 Tab 导航  │
│  ┌─────┬─────┬─────┬───┐ │
│  │会话  │文件  │终端  │设置│ │  ← iOS 26: 原生 Liquid Glass TabBar
│  └─────┴─────┴─────┴───┘ │
│ 会话页 = 会话列表 ⇄ 聊天详情 │  ← 推入式导航，右滑返回
└─────────────────────────┘
```

- **导航模式**：底部 Tab（4 项）+ 页面内推入栈；iOS 用原生玻璃 TabBar（见 §5），Android 用 Material 3 Navigation Bar（web 实现 + 玻璃拟态）
- **Sheet 体系**：权限请求、问题卡片、模型选择、会话操作菜单一律用 Bottom Sheet（弹簧动效、下滑关闭、触觉反馈）
- **手势**：列表项左滑 = 快捷操作（改名/删除）；聊天页右滑 = 返回；输入框上滑 = 展开全屏编辑器；长按消息 = 操作菜单 + 触觉
- **安全区**：全面使用 `env(safe-area-inset-*)`；iOS 26 注意 WKWebView 边缘效果（`scrollView.topEdgeEffect.isHidden`，由 glass 插件统一处理）
- **键盘**：输入框聚焦时工具条（agent/model/附件）吸附键盘顶；`interactive-widget=resizes-content`
- **特效细节（“精致感”来源）**：
  - 消息气泡/卡片：玻璃拟态 + 细描边高光（`--glass-border`），进入时 spring 上浮 + 渐显
  - 生成中：光标呼吸光晕；工具调用卡片有进度光扫（shimmer）
  - 页面转场：共享元素过渡（会话卡片 → 聊天页标题）
  - 触觉：发送/完成/权限/错误 4 种触感模式（haptics 插件）
  - 状态栏：随内容动态切换深浅（glass 插件控制）

### 4.2 功能齐全性保障（移动端不阉割）

| 能力 | 移动端形态 |
|---|---|
| 多服务器 | 首页卡片网格 + 扫码添加（服务器桌面端可显示二维码）+ mDNS 自动发现列表 |
| 会话切换 | 会话 Tab → 列表（分组/搜索/滑动操作）；聊天页左上角会话切换器 |
| 文件夹切换 | 会话列表顶部 project 选择器（Bottom Sheet） |
| 权限/问题 | 全屏 Bottom Sheet + 系统通知 + 角标，绝不漏处理 |
| 文件/搜索 | 文件 Tab：树形浏览 + 顶部搜索（文件/全文/符号三段切换）；查看器支持语法高亮与 diff 着色 |
| 终端 | 终端 Tab：xterm.js + 自定义屏幕键盘条（Esc/Tab/Ctrl/方向键/`/`）；横屏自动全屏 |
| diff | 会话内 diff 页（左右分栏在竖屏自动转上下/统一视图） |
| 设置 | 完整 Config/MCP/Provider/主题/语言管理 |

## 5. iOS 26 Liquid Glass 实施方案 ⚠️ 关键技术决策

**结论先行：WKWebView 内无法用纯 CSS 实现真正的 Liquid Glass**（WebKit 不支持 `backdrop-filter` 的 SVG 位移滤镜，Apple bug #245510；私有属性 `-apple-visual-effect: -apple-system-glass-material` 需开私有 `WKPreferences.useSystemAppearance`，会导致 App Store 拒审）。因此采用**三档方案**：

### 档位 A：原生玻璃（iOS 26+，首选）

自研 Tauri 插件 `tauri-plugin-glass`（`src-tauri/plugins/glass/`）：

- **Swift 侧**：在 `UIWindow` 上注入原生 `UITabBar`（iOS 26 SDK 编译自动获得 Liquid Glass 材质）与 `UIVisualEffectView`（`.systemUltraThinMaterial` 等，用于浮动工具条/PromptBox 底座）
- **桥接契约**（web ⇄ native）：
  - web → native：`glass_set_tab_items` / `glass_set_active` / `glass_set_hidden` / `set_badge`
  - native → web：`tabSelected` 事件 → 驱动前端路由
- **内容下延**：原生 bar 半透明悬浮，web 内容滚动至其下方，前端为 tab bar 预留 `padding-bottom`
- **实施顺序（Spike 先行）**：M7 第一个任务即做最小 Spike 验证（注入 bar + 事件回传），验证不过则全程走档位 B

### 档位 B：CSS 玻璃拟态（iOS < 26 / Android / 桌面浮动元素）

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.6);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.6);
  border: 0.5px solid var(--glass-border);
  box-shadow: 0 8px 32px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.08);
  border-radius: var(--r-xl);
}
```

- 追求视觉近似：多层叠加（高光描边 + 内阴影 + 背景饱和提升）
- 性能护栏：`backdrop-filter` 元素同屏 ≤ 4 个、固定尺寸、避免动画中改变 blur 半径（移动端 GPU 限制）

### 档位 C：macOS 26 桌面玻璃

- `window-vibrancy` crate 的 `apply_liquid_glass`（`NSGlassEffectView`，macOS 26+）应用于侧栏/窗口材质
- 低版本 macOS 回退 `apply_vibrancy(NSVisualEffectMaterial::Sidebar)`

### 运行时降级逻辑

```
if iOS >= 26 && glassPlugin.available → 原生玻璃（档位 A）
else → CSS 玻璃拟态（档位 B）
if 用户设置"减少动态效果"或"省电模式" → 纯色半透明（无 blur）
```

## 6. 萌宠陪伴（桌面版，`features/pet` + `src-tauri/pet/`）

| 项 | 方案 |
|---|---|
| 形态 | 独立 `WebviewWindow`：透明背景、无边框、always-on-top、可拖拽、尺寸 ~160×160px，可贴边停靠 |
| 动画 | **Rive**（决策点 D4）：单个 `.riv` 状态机文件，输入为枚举状态 |
| 状态机 | `idle`(打瞌睡/玩玩具) · `working`(敲键盘, 跟随 token 速率) · `waiting_permission`(举手提醒) · `success`(庆祝) · `error`(抱头) · `attention`(点击互动/喂食彩蛋) |
| 事件联动 | 订阅 SSE：`session.status(busy)→working`、`permission.asked→waiting`、`session.idle→success→idle`、`session.error→error`；多服务器时跟随当前激活服务器 |
| 交互 | 单击=摸头动画+音效(可关)；双击=收起/展开小窗；右键=设置（透明度/大小/置顶/静音/隐藏） |
| 资源 | Rive 文件 < 500KB；GPU 友好的矢量动画；Linux 无透明合成环境时降级为普通圆角小窗 |
| 开关 | 默认开启但欢迎页可关；状态栏 🐾 图标一键唤起/隐藏；绝不遮挡输入（自动避让活动窗口底部，可选） |

## 7. 主题与可访问性

- 主题：`dark`（默认）/ `light` / 跟随系统；移动端额外“真黑 OLED”选项
- 强调色：预设 6 色 + 自定义拾色，写入 `--accent` 一族变量
- 可访问性：全键盘焦点环可见；`prefers-reduced-motion` 时禁用弹簧/玻璃动效；对比度 ≥ WCAG AA（4.5:1）；屏幕阅读器语义（Kobalte 组件基座保障）
- 文案：所有用户可见字符串走 i18n key（见 M9），emoji 不进 UI 正式文案
