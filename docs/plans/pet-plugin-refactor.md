# 可交互宠物插件重构实施计划

> 状态：待实施  
> 日期：2026-09-01  
> 范围：桌面端宠物窗口、宠物设置页、可安装宠物包；不修改 OpenCode API 契约  
> 依据：`docs/PLAN.md`、`docs/architecture.md`、`docs/AGENT_PLAYBOOK.md`、`docs/testing.md`、`docs/ui-design.md`

## 1. 结论

本次重构不再把系统 Emoji 当成宠物素材。宠物应是应用可控、跨平台一致的原创图形资产，运行在透明悬浮窗口中，能响应编码状态和用户指针交互。

实现采用“数据型宠物包”架构：内置宠物和用户安装的宠物使用同一份 manifest、同一套渲染器和同一套状态/交互协议。第三方宠物包只包含声明式配置与媒体资产，不执行 JavaScript，不获得网络、文件系统或 Tauri IPC 权限。

设置页使用 ListView 展示所有可用宠物：每行包含真实缩略预览、名称、作者/来源、渲染器类型、选中状态和可用操作；“添加宠物”从本地导入 `.opet` 文件。原来的宠物类型下拉框删除，其余窗口偏好保留并分组展示。

## 2. 当前实现审计

### 2.1 已经可复用的能力

- Rust 已创建独立的透明、无边框、置顶 `pet` WebviewWindow，并支持显示/隐藏、拖拽、尺寸、内容透明度、置顶、边缘停靠和点击穿透。
- 主窗口已有 `idle`、`working`、`waiting`、`success`、`error`、`attention` 六态事件通道和 0–100 工作强度通道。
- `petEvents.ts` 已将会话状态、权限、问题与 token 速率聚合为宠物状态，优先级和瞬态释放规则已有单元测试。
- 当前交互已有单击摸头、双击收起/恢复和窗口拖拽，偏好保存在 `oc-pet`。
- 设置中心已经有独立 Pet 分区，具备 i18n、可滚动内容区和组件测试基础。

### 2.2 必须替换的问题

- `PetShell.tsx` 直接渲染 `🐱`、`🐶`、`🤖` 等 OS Emoji；字形随平台变化，无法形成产品角色，也无法精确控制表情、身体和命中区域。
- 所谓 `PetRenderer` 目前只有两个方法的 TypeScript 接口，没有资产生命周期、异步加载、失败回退、交互触发或插件能力。
- `PetType` 是硬编码 union，设置页使用 `<select>`；增加宠物必须改代码、i18n 和发布应用，用户不能自行安装。
- CSS 动画只移动 Emoji 外层，无法让眼睛、脸屏、四肢等局部独立响应，也没有素材级状态映射。
- 偏好存于 WebView `localStorage`，而可安装包必须由 Rust 安全地管理文件、校验路径并跨窗口提供一致清单。
- 当前“漫游”通过定时随机瞬移窗口，不像角色移动；重构阶段不应继续扩展该行为，先保留兼容选项，再单独评估路径移动。

## 3. 视觉与体验基准

用户提供的 Codex 截图只作为体验基准，不作为可复制的美术资产。截图中的有效特征是：

- 角色由完整自绘像素图构成，不依赖 Emoji 字体；轮廓、身体、脸屏和高光在各平台一致。
- 透明悬浮在应用内容之上，没有卡片底、窗口边框或状态文字干扰。
- 角色有清楚的待机姿态和可点击入口，尺寸虽小仍可识别表情。
- 角色与应用有统一的科技感，但不能照搬 Codex 机器人的造型、配色细节或动画。

第一批内置宠物至少包含两只原创宠物包：

1. 默认原创像素机器人：有独立剪影、可变化的脸屏、身体待机和点击反馈；视觉方向可参考“编码伙伴”，但必须与 Codex 角色明显不同。
2. 原创纸箱猫：替代现有 Emoji 猫，耳朵、眼睛、尾巴和纸箱均由项目资产绘制，状态变化不能只依赖整体位移。

美术验收需要产品截图确认。实施 agent 不得从用户截图裁切、描摹或打包任何 Codex 图像。

## 4. 产品范围

### 4.1 本期必须交付

- 移除宠物窗口中的 Emoji 渲染路径。
- 内置宠物和第三方宠物统一走宠物包注册表。
- 支持 Sprite 和 Rive 两种数据型渲染器；单帧透明图是 Sprite 的退化形式。
- 设置页 ListView 浏览、选择、导入和移除宠物。
- `.opet` 安装包、manifest v1、原子安装、升级、校验、错误提示和损坏包隔离。
- 编码六态、工作强度、单击、悬停、按下、拖拽开始/结束、双击收展的统一交互协议。
- 旧 `petType` 偏好迁移到内置宠物包 ID，其他偏好不丢失。
- 英文/简体中文文案、减少动态效果、键盘可达的设置列表、完整测试与创作者文档。

### 4.2 明确不做

- 不允许宠物包携带或执行 JavaScript、HTML、CSS、Wasm 或原生代码。
- 不开放网络访问、shell、OpenCode API、任意文件读取或额外 Tauri capability。
- 不建设在线宠物商店、账号同步、自动联网更新或签名市场。
- 不在本期支持 Live2D、Spine、3D 模型、脚本 AI、语音或音效。
- 不承诺透明像素级的操作系统点击穿透；窗口级“全部穿透”开关继续保留。
- 不把随机瞬移改造成完整的屏幕寻路系统；本期只保证固定模式和拖拽体验正确。

## 5. 目标用户流程

### 5.1 选择内置或已安装宠物

1. 用户打开 Settings → Pet。
2. 页面顶部显示“宠物形象”ListView，当前宠物行带选中标记。
3. 每行直接播放低频待机预览；开启减少动态效果时显示静态关键帧。
4. 单击某行立即切换悬浮宠物；切换失败时回滚选中项并显示行内错误。
5. 全局显示、大小、不透明度、移动方式和点击穿透设置位于列表下方，和角色选择分离。

### 5.2 添加自己的宠物

1. 用户点击“添加宠物…”，系统文件对话框只选择 `.opet`。
2. Rust 在临时 staging 目录解包并验证 manifest、路径、文件数量、体积、媒体类型和所有引用。
3. 验证通过后展示确认信息：预览、名称、作者、版本、渲染器和“本地未签名宠物包”说明。
4. 用户确认后原子移动到应用数据目录，注册表刷新；默认不自动切换，确认页可勾选“安装后使用”。
5. 同 ID 更高版本走升级流程；同版本重复导入提示已安装；更低版本要求明确确认降级。
6. 失败时不留下半安装目录，错误必须说明具体文件和规则。

### 5.3 管理宠物

- 内置宠物显示“内置”标记，不能移除。
- 用户宠物行提供“移除”；当前正在使用的宠物不能直接移除，先要求切换到默认宠物。
- 移除只删除应用数据目录中的该宠物包；原始 `.opet` 文件不受影响。
- 启动时发现损坏包，将其排除出可选列表并显示一次可恢复的诊断提示，不阻止应用启动。

## 6. 设置页 ListView 规格

### 6.1 布局

列表位于 Pet 分区内容顶部，使用单列 ListView，而不是 select 或卡片网格：

```text
宠物形象                                      [添加宠物…]
┌──────────────────────────────────────────────────────────┐
│ [48px 动态预览] Byte              原创 · 内置 · Sprite  ✓ │
│                  opencoder team                           │
├──────────────────────────────────────────────────────────┤
│ [48px 动态预览] Box Cat           原创 · 内置 · Sprite    │
│                  opencoder team                           │
├──────────────────────────────────────────────────────────┤
│ [48px 动态预览] My Fox             本地 · Rive         [⋯] │
│                  Alice · v1.2.0                            │
└──────────────────────────────────────────────────────────┘

行为
  显示宠物                                             [开关]
  移动方式                                      [固定/底部/漫游]
  大小 · 160px                                      [滑杆]
  不透明度 · 100%                                   [滑杆]
  点击穿透                                             [开关]
```

### 6.2 行为细节

- 行高不少于 64px；缩略图容器 48×48px，透明棋盘格仅用于设置页预览，不出现在宠物窗口。
- 整行是单选项，使用 `role="listbox"` + `role="option"` 或等价的 Kobalte 单选集合语义；上下方向键移动，Enter/Space 选择。
- 名称单行省略，作者/版本/来源为次级文本；选中标记不能只靠颜色。
- 缩略预览必须使用真实宠物渲染器和 `idle` 状态，不能另做一张与实际不一致的假图；性能不足时使用 manifest 的静态 preview。
- 导入、删除和切换时只锁定相关行，不冻结整个设置页。
- 列表为空或注册表失败时，内置默认宠物仍必须可用。
- 搜索关键词补充 `pet pack`、`mascot`、`import`、`sprite`、`rive`、`宠物包`、`导入`。

## 7. 宠物包格式 v1

### 7.1 文件结构

`.opet` 是 ZIP 容器，根目录必须直接包含 `manifest.json`：

```text
my-fox.opet
├── manifest.json
├── preview.png
└── assets/
    ├── fox.riv
    └── fallback.webp
```

Sprite 包示例：

```text
box-cat.opet
├── manifest.json
├── preview.webp
└── assets/
    ├── idle.webp
    ├── working.webp
    ├── waiting.webp
    ├── success.webp
    ├── error.webp
    ├── attention.webp
    └── reactions.webp
```

### 7.2 Manifest 示例

```json
{
  "$schema": "https://opencoder.dev/schemas/pet-pack-v1.json",
  "schemaVersion": 1,
  "id": "dev.opencoder.byte",
  "name": "Byte",
  "version": "1.0.0",
  "author": "opencoder team",
  "license": "MIT",
  "description": "An original pixel coding companion.",
  "preview": "preview.webp",
  "renderer": {
    "type": "sprite",
    "pixelated": true,
    "canvas": { "width": 256, "height": 256 },
    "states": {
      "idle": { "asset": "assets/idle.webp", "frames": 8, "fps": 8, "loop": true },
      "working": { "asset": "assets/working.webp", "frames": 8, "fps": 12, "loop": true },
      "waiting": { "asset": "assets/waiting.webp", "frames": 6, "fps": 8, "loop": true },
      "success": { "asset": "assets/success.webp", "frames": 8, "fps": 12, "loop": false },
      "error": { "asset": "assets/error.webp", "frames": 6, "fps": 6, "loop": true },
      "attention": { "asset": "assets/attention.webp", "frames": 8, "fps": 12, "loop": false }
    },
    "reactions": {
      "tap": { "asset": "assets/reactions.webp", "startFrame": 0, "frames": 6, "fps": 12 },
      "hover": { "state": "attention" },
      "dragStart": { "state": "attention" },
      "drop": { "asset": "assets/reactions.webp", "startFrame": 6, "frames": 4, "fps": 10 }
    }
  },
  "interaction": {
    "hitbox": { "x": 0.16, "y": 0.08, "width": 0.68, "height": 0.86 },
    "tapRevertsAfterMs": 1800
  }
}
```

### 7.3 必填与回退规则

- 必填：`schemaVersion`、`id`、`name`、`version`、`author`、`preview`、`renderer`、`renderer.states.idle`。
- `id` 使用反向域名风格，只允许 ASCII 小写字母、数字、点和连字符，长度 3–128。
- `version` 必须是有效 SemVer；应用以 `id` 识别同一宠物包。
- 状态缺失时回退到 `idle`；reaction 缺失时保留当前状态并应用统一的轻微缩放反馈。
- `working` 的播放速度可由强度调整，但最终 fps 必须 clamp 到 1–30。
- Sprite 每个状态使用横向等宽帧；`canvas.width / frames` 必须得到整数帧宽，所有状态的逻辑画布一致。
- Rive manifest 指定 `.riv`、state machine 名和标准输入映射；必须至少能进入 idle。未知 input 被忽略并记诊断，不导致崩溃。
- preview 只允许 PNG/WebP；运行时资产只允许 PNG/WebP/Rive。SVG、GIF、HTML、CSS、JS、Wasm、字体和嵌套压缩包在 v1 拒绝安装。
- 文本字段是纯文本；设置页不得把 description 当 HTML 注入。

### 7.4 Rive 标准输入

Rive 宠物包可以把应用语义映射到自己的输入名：

```json
{
  "renderer": {
    "type": "rive",
    "asset": "assets/fox.riv",
    "artboard": "Pet",
    "stateMachine": "PetMachine",
    "inputs": {
      "state": "state",
      "intensity": "intensity",
      "tap": "tap",
      "hovered": "hovered",
      "dragging": "dragging"
    }
  }
}
```

`state` 的数值契约固定为 idle=0、working=1、waiting=2、success=3、error=4、attention=5。`intensity` 为 0–100；`tap` 是 trigger；`hovered` 和 `dragging` 是 boolean。

### 7.5 包安全限制

- 压缩包最大 20 MiB；解压后总大小最大 50 MiB；最多 256 个文件；单文件最大 16 MiB。
- 拒绝绝对路径、`..`、空路径段、超长路径、反斜杠逃逸、符号链接、硬链接和设备文件。
- 先校验 central directory，再逐文件限流解压；不能仅相信 ZIP 声明的未压缩大小。
- 校验媒体 magic bytes，不只依赖扩展名；所有 manifest 引用必须存在且位于包根目录内。
- staging 目录使用随机名称；只有全部校验通过才原子 rename 到目标版本目录。
- 注册表记录 manifest 摘要和内容 SHA-256；启动时检测篡改，损坏包不加载。
- 第三方包永远不加入 `default` capability；宠物窗口只读取已选择包的声明式资产。
- 所有读取以 canonical pack root 为边界，任何路径解析失败都返回结构化错误。

## 8. 运行时架构

```text
Settings ListView ── select/install/remove ──> petPacks service
        │                                          │
        │                                   Tauri IPC commands
        ▼                                          ▼
preview renderer                         Rust PetPackManager
        │                               ├─ bundled read-only packs
        │                               ├─ app-data installed packs
        │                               ├─ validation / atomic install
        │                               └─ binary asset response
        │                                          │
        └──────── selected pack + prefs ───────────┘
                           │ pet-prefs event
                           ▼
                      PetShell host
                    ├─ renderer factory
                    │  ├─ SpritePetRenderer
                    │  └─ RivePetRenderer
                    ├─ interaction controller
                    └─ existing state/intensity subscriptions
```

### 8.1 存储布局

```text
Tauri resource dir/
└── pets/                         # 随应用发布，只读
    ├── dev.opencoder.byte/
    └── dev.opencoder.box-cat/

Tauri app data dir/
└── pet-packs/
    ├── registry.json             # 派生索引，可重建
    ├── installed/
    │   └── com.example.fox/1.2.0/
    ├── staging/                  # 启动时清理遗留
    └── quarantine/               # 损坏包诊断；限量保留
```

内置包和安装包都产生同一种 `PetPackSummary`。内置 ID 优先且保留 `dev.opencoder.*` 命名空间；第三方包不能覆盖内置包。

### 8.2 Rust 命令

新增命令保持最小面：

- `pet_pack_list() -> Vec<PetPackSummary>`
- `pet_pack_install(path, allow_downgrade) -> PetPackInstallResult`
- `pet_pack_remove(id) -> ()`
- `pet_pack_read_asset(id, relative_path) -> tauri::ipc::Response`
- `pet_pack_diagnostics() -> Vec<PetPackDiagnostic>`

安装命令只接受系统文件对话框返回的本地路径；仍需把该路径视为不可信输入。二进制资产通过 IPC binary response 交给前端，前端创建并缓存 Blob URL，在切换或卸载时 revoke；不扩大 asset protocol 的全局文件 scope。

### 8.3 前端领域类型

```ts
type PetPackSource = "bundled" | "installed";
type PetRendererKind = "sprite" | "rive";

interface PetPackSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  source: PetPackSource;
  renderer: PetRendererKind;
  preview: string;
  removable: boolean;
  contentHash: string;
}

interface PetRenderer {
  mount(host: HTMLElement, pack: LoadedPetPack): Promise<void>;
  setState(state: PetAnimationState): void;
  setIntensity(intensity: number): void;
  setInteraction(interaction: PetInteraction, active: boolean): void;
  setReducedMotion(reduced: boolean): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  dispose(): void;
}
```

Renderer 必须是实例级对象，不能把状态留在全局。`mount` 失败时 PetShell 使用内置默认宠物重试一次；默认宠物也失败时显示无 Emoji 的极简内置 SVG 错误轮廓，并记录诊断。

### 8.4 偏好迁移

`PetPrefs` 将 `petType?: "blob" | "cat" | "dog" | "robot"` 改为 `selectedPackId?: string`，迁移只执行一次：

| 旧值 | 新包 ID |
|---|---|
| `robot` | `dev.opencoder.byte` |
| `cat` | `dev.opencoder.box-cat` |
| `dog` | `dev.opencoder.byte`，并记录一次兼容回退 |
| `blob` | `dev.opencoder.byte` |
| 缺失/非法 | `dev.opencoder.byte` |

迁移保留 movement、size、opacity、topmost、mute、dock 和 clickThrough。新偏好写入 Rust store，主窗口和宠物窗口均从同一持久源读取；迁移成功后不再依赖 `oc-pet`，但保留一个版本周期的只读迁移代码。

## 9. 状态与交互协议

### 9.1 编码状态

保留现有优先级：

```text
error > waiting > working > success > attention > idle
```

状态语义不由宠物包重新定义：

| 状态 | 触发 | 角色要求 |
|---|---|---|
| idle | 无活动 | 可识别的低频呼吸/眨眼，不能持续吸引注意 |
| working | 会话 busy/retry | 明显进入工作，速度随 intensity 变化 |
| waiting | 等待权限/用户回答 | 明确看向用户或举手，不用文字提示代替表演 |
| success | 生成完成瞬态 | 一次庆祝后回到 idle |
| error | 会话错误 | 可辨认的受挫表情，不能只变红 |
| attention | 问题或本地互动 | 看向指针/招手，随后回到上一个转发状态 |

### 9.2 指针交互

| 输入 | 标准行为 | 包可定制部分 |
|---|---|---|
| pointer enter | 眼睛/脸屏跟随指针，或 attention 轻反应 | `hover` reaction / Rive hovered input |
| pointer leave | 回到最后一个编码状态 | 离场过渡动画 |
| primary down | 压缩/抬手反馈；超过拖拽阈值进入拖动 | `press` reaction |
| single click | 摸头/打招呼；结束后恢复编码状态 | `tap` reaction 与时长 |
| drag start | 角色被提起，暂停点击判定 | `dragStart` reaction |
| drag end | 窗口落下并按设置吸附边缘 | `drop` reaction |
| double click | 收起/恢复窗口 | 不允许包覆盖，保证一致逃生路径 |
| right click | 打开原生风格菜单：更换宠物、设置、隐藏 | 菜单内容不由包控制 |

点击与拖拽必须使用 4–6px 移动阈值和时间阈值区分；拖拽完成不能再触发单击。透明画布上只有 manifest hitbox 内显示抓取光标和互动反馈。

### 9.3 状态仲裁

- 编码状态是持久基态；本地互动是有截止时间的 overlay，不回写主窗口状态机。
- `error` 和 `waiting` 默认不被 hover/tap 覆盖；只播放不改变主表情的轻反馈。
- 新编码状态随时打断本地 reaction；reaction 完成后读取最新基态，不能保存旧快照回退。
- 切换宠物时传递当前基态、intensity、reduced-motion 和 pointer 状态，不能闪回 idle。
- 窗口隐藏、页面不可见或应用退出时 renderer 停止 animation loop 并释放 Blob URL、Canvas 和 Rive 实例。

## 10. 文件与模块规划

建议目标结构：

```text
src-tauri/
├── resources/pets/<pack-id>/...
└── src/pet/
    ├── mod.rs                   # 现有窗口与命令入口
    ├── packs.rs                 # registry / install / remove / asset read
    ├── manifest.rs              # serde 类型与语义校验
    └── archive.rs               # ZIP 安全解包

src/
├── services/
│   ├── pet.ts                   # 窗口与状态门面
│   └── petPacks.ts              # 包清单、安装、移除、二进制资产
└── features/pet/
    ├── PetShell.tsx             # 只做宿主和生命周期
    ├── PetSurface.tsx           # 共用实际/预览表面
    ├── interaction.ts           # pointer/drag/click 仲裁
    ├── packTypes.ts             # manifest/summary 类型
    ├── packStore.ts             # registry 与 selected pack signal
    ├── renderers/
    │   ├── types.ts
    │   ├── sprite.ts
    │   ├── rive.ts
    │   └── fallback.ts
    └── prefs.ts                 # 新 store + localStorage migration

src/features/settings/
├── PetSection.tsx
├── PetPackList.tsx
└── PetPackImportDialog.tsx

docs/
├── pet-pack-format.md
└── examples/pet-pack/
```

如果把现有 `src-tauri/src/pet.rs` 拆成目录，必须在一个任务中完成且保持 `mod pet` 的外部命令名不变，避免无关调用方同时修改。

## 11. 测试与质量门槛

### 11.1 L1 单元测试

- Rust manifest：必填字段、ID、SemVer、状态回退、Rive input、Sprite 帧几何和所有边界。
- Rust archive：Zip Slip、绝对路径、Windows 路径、symlink、伪扩展名、magic bytes、文件数/大小/压缩炸弹、缺失引用、嵌套压缩包。
- Rust registry：内置优先、安装、升级、降级确认、重复导入、原子失败回滚、移除、损坏隔离和 registry 重建。
- TS service：Tauri/no-Tauri 分支、binary response、Blob URL 缓存/revoke、错误结构转换。
- prefs：每个旧 `petType` 的迁移、幂等迁移、选中包失效回退和其他偏好保留。
- renderers：状态回退、intensity clamp、reaction 完成、reduced motion、resize、dispose。
- interaction：单击/双击/拖拽互斥、阈值、hover、编码状态打断和 error/waiting 优先级。

### 11.2 L2 组件测试

- PetPackList 的真实行结构、选中态、键盘导航、切换回滚、内置/本地标记和菜单可用性。
- 导入对话框的 loading、确认、升级/降级、结构化错误和取消清理。
- PetShell 在 Sprite/Rive mock 下同步六态、工作强度、interaction、切包和 fallback。
- reduced-motion 下无循环动画但状态仍可辨识。
- axe 检查设置列表、导入确认和错误提示。

### 11.3 Rust/桌面集成测试

- 真实临时目录完成 `.opet` 安装、重启重建、读取资产、切换和移除。
- pet window 透明、无装饰、不抢焦点、可拖动；隐藏后动画暂停，显示后恢复当前状态。
- macOS、Windows、Linux 分别做透明度和缩放冒烟；无 compositor 的 Linux 继续采用现有降级说明。

### 11.4 E2E 与视觉验收

- 从 Settings 导入 fixture → 列表出现 → 选择 → 宠物窗口切换 → 重启仍保持 → 切回默认 → 移除。
- 模拟 busy、permission、success、error，录制状态截图或短视频；每个内置宠物六态均能肉眼区分。
- 120/160/200px、1x/2x DPR、浅色/深色背景均无方形底、裁切或模糊缩放。
- 与用户提供的 Codex 截图并排评审“完整角色、透明悬浮、可互动”三项，但不得做像素相似度或复制性验收。
- `pnpm verify` 必须 11/11；涉及宠物窗口交互，额外运行 `pnpm test:e2e`。

### 11.5 性能预算

- 未打开宠物设置时，不把预览 renderer 或全部宠物资产加载进主窗口。
- PetShell 只加载当前宠物；切换后释放旧 renderer 和 Blob URL。
- Sprite idle 默认不超过 12fps，活跃态不超过 30fps；Rive 在隐藏/不可见时 pause。
- 每个内置包压缩后目标不超过 2 MiB；应用启动 chunk 不包含 Rive runtime，使用动态 import。
- `pnpm build && pnpm check:bundle` 不突破现有启动包预算；若 Rive runtime 形成独立懒加载 chunk，在任务报告中列出 gzip 体积。

## 12. 分阶段任务卡

以下任务严格串行执行，除非任务卡明确允许并行。每张任务都要按 `docs/AGENT_PLAYBOOK.md` 完成测试、双语 changelog、单独 commit 和报告。

### TASK-PET-01 冻结宠物包 v1 契约与测试夹具

- **前置**：无。
- **模块**：`docs/`、`tests/fixtures/pet-packs/`。
- **范围**：新增 `docs/pet-pack-format.md`、JSON Schema、最小 Sprite/Rive manifest fixture、恶意 ZIP fixture 生成脚本；不改运行时代码。
- **规格**：把本计划 §7 转成公开创作者规范；示例必须能被后续 Rust validator 直接消费；恶意压缩包由测试脚本生成，不提交巨大二进制。
- **验收**：schema 能校验合法示例并拒绝缺字段、未知 schemaVersion 和路径逃逸引用；文档说明许可证、预览、安全限制和调试流程。
- **测试**：新增 schema/fixture 自检脚本并接入现有测试命令；`pnpm verify` 11/11。
- **提交**：`docs(pet): define the pet pack v1 format (PET-01)`。

### TASK-PET-02 实现 Rust 宠物包管理器

- **前置**：PET-01。
- **模块**：`src-tauri/src/pet/`。
- **范围**：拆分 `pet.rs`，新增 manifest/archive/registry，实现 list/install/remove/read-asset/diagnostics；修改 `Cargo.toml`、`lib.rs`、Tauri resources 配置和必要 capability。
- **规格**：严格执行 §7.5；安装/升级原子化；内置 namespace 不可覆盖；binary response 不暴露任意路径；所有错误使用稳定 code + detail。
- **验收**：应用无已安装包时仍返回内置包；损坏用户包不阻止启动；安装失败不留下可见半包；移除当前包由调用方预检且 Rust 再次拒绝。
- **测试**：Rust L1 覆盖 §11.1 全部 archive/registry 场景，使用临时目录；`cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test`、`pnpm verify`。
- **提交**：`feat(pet): add the secure pet pack registry (PET-02)`。

### TASK-PET-03 建立前端注册表、资产服务与偏好迁移

- **前置**：PET-02。
- **模块**：`src/services/petPacks.ts`、`src/features/pet/packTypes.ts`、`packStore.ts`、`prefs.ts`。
- **范围**：添加 typed facade、注册表 store、binary asset/Blob URL 生命周期；把 `petType` 迁移成 `selectedPackId` 并改用 Rust store。
- **规格**：无 Tauri 环境返回内置测试清单或明确空清单；启动选择丢失时回退默认包；跨 main/pet window 通过现有 `pet-prefs` 事件同步选择。
- **验收**：旧用户升级后仍保留大小、不透明度等设置；cat/robot 映射正确；切包不重启宠物窗口；卸载/切换时 URL 全部 revoke。
- **测试**：service、store、migration 和 asset cache L1；保留现有 prefs 行为回归；`pnpm verify` 11/11。
- **提交**：`feat(pet): add pet pack state and preference migration (PET-03)`。

### TASK-PET-04 实现 Sprite/Rive 渲染宿主

- **前置**：PET-03。
- **模块**：`src/features/pet/renderers/`、`PetSurface.tsx`、`PetShell.tsx`。
- **范围**：renderer factory、Sprite Canvas、Rive 懒加载、fallback、resize/reduced-motion/dispose；移除 Emoji DOM 和旧 `.pet-character-*` CSS。
- **规格**：两个渲染器遵守同一接口；状态缺失回退 idle；切换保持当前状态；Rive runtime 独立动态 chunk；fallback 不能使用 Emoji。
- **验收**：六态和 intensity 在两种 renderer mock 下工作；损坏包自动回退默认；窗口背景完全透明；隐藏窗口不继续刷新。
- **测试**：renderer L1、PetSurface/PetShell L2、bundle 报告；`pnpm verify` 和针对性桌面 smoke。
- **提交**：`feat(pet): render data-driven sprite and rive pets (PET-04)`。

### TASK-PET-05 制作原创内置宠物资产

- **前置**：PET-04。
- **模块**：`src-tauri/resources/pets/`、资产源文件说明。
- **范围**：默认像素机器人和纸箱猫两个完整宠物包，包含 preview、六态和 tap/hover/drag/drop 反应；不改业务逻辑。
- **规格**：无 Emoji、无第三方受限资产、原创来源和许可证写入 manifest；每只角色至少两个局部会动；像素宠物使用整数缩放与 `image-rendering: pixelated`。
- **验收**：120/160/200px 可辨识，无裁切/方底；六态肉眼可区分；产品评审确认视觉质量后才进入后续 UI 收口。
- **测试**：所有内置包通过 PET-01 schema 和 PET-02 validator；生成状态联系图及 macOS 透明窗口截图作为任务证据；`pnpm verify`。
- **提交**：`feat(pet): add original interactive companion packs (PET-05)`。

### TASK-PET-06 完成交互控制器和宠物窗口菜单

- **前置**：PET-05。
- **模块**：`src/features/pet/interaction.ts`、`PetShell.tsx`、`src-tauri/src/pet/` 必要窗口命令。
- **范围**：hover、press、single click、drag start/end、double click、右键菜单；保留编码状态仲裁和窗口吸附。
- **规格**：严格执行 §9；拖拽不误触单击；error/waiting 不被低优先级互动覆盖；右键菜单只含宿主操作，包不能注入菜单项。
- **验收**：鼠标直接和角色互动；拖动手感连续；双击收展仍是可靠逃生路径；点击穿透开启后能从主设置页关闭。
- **测试**：interaction L1 时序矩阵、PetShell L2、桌面窗口 smoke；交互涉及核心宠物流程，运行 `pnpm test:e2e`。
- **提交**：`feat(pet): add direct companion interactions (PET-06)`。

### TASK-PET-07 把宠物设置改为 ListView 和导入管理界面

- **前置**：PET-03、PET-05；建议在 PET-06 后执行以便预览完整互动。
- **模块**：`src/features/settings/`、`src/i18n/en.json`、`src/i18n/zh-CN.json`。
- **范围**：`PetPackList`、导入确认/错误对话框、移除流程、ListView 布局、搜索关键词；删除类型 select，重排全局行为设置。
- **规格**：执行 §5–§6；预览懒加载；内置与本地来源可辨；选择即时应用且失败回滚；所有文案 i18n 双写。
- **验收**：设置页可看到并切换当前所有宠物；可导入/升级/移除 `.opet`；键盘和屏幕阅读器可用；窄窗口和 80%–120% UI scale 不横向裁切。
- **测试**：PetPackList/ImportDialog/PetSection L2 + axe；设置页 E2E 完整导入/切换/重启/移除旅程；`pnpm check:i18n`、`pnpm verify`、`pnpm test:e2e`。
- **提交**：`feat(settings): manage pet packs in a list view (PET-07)`。

### TASK-PET-08 跨平台硬化与创作者交付

- **前置**：PET-01–PET-07。
- **模块**：`docs/`、`tests/e2e/`、必要的宠物测试文件；不新增产品能力。
- **范围**：创作者教程、示例包、故障诊断、跨平台验证表、性能记录、截图/短视频证据和回归修复。
- **规格**：文档从零说明制作 Sprite 包、Rive 输入映射、打包、导入、升级和常见校验错误；示例包使用 MIT 原创资产。
- **验收**：第三方只按文档即可制作并导入一只静态或动画宠物；macOS/Windows/Linux 冒烟结果如实记录；已知平台降级有明确说明。
- **测试**：`pnpm verify` 11/11、`pnpm test:e2e`、`pnpm test:coverage`，记录真实输出；人工检查所有内置宠物六态和交互。
- **提交**：`docs(pet): publish the pet pack creator guide (PET-08)`。

## 13. 执行顺序与所有权

推荐单线顺序：

```text
PET-01 → PET-02 → PET-03 → PET-04 → PET-05 → PET-06 → PET-07 → PET-08
```

PET-06 和 PET-07 理论上可并行，但两者都会触碰 `PetShell`/设置预览的交互契约，默认串行更安全。若确需并行，PET-06 独占 `src/features/pet/`，PET-07 独占 `src/features/settings/` 和 i18n；`PetSurface` API 在 PET-04 后冻结，双方不得跨目录修改。

每个 agent 开始前必须：

1. 阅读本计划和对应任务卡。
2. 阅读 `docs/AGENT_PLAYBOOK.md`、`docs/testing.md` 和当前模块代码。
3. 用 `git log` 确认前置任务 commit 存在。
4. 检查工作树并声明文件所有权；发现重叠修改即停止协调。
5. 只实现当前任务，不顺手重构相邻模块。

## 14. Review Gate

### Gate A：协议与安全（PET-01–PET-03）

- 合法/恶意 fixtures 全部有自动化结论。
- 用户包不能执行代码、访问网络或读取包外文件。
- 安装/升级/失败回滚/损坏恢复真实可演示。
- 旧偏好迁移无数据丢失。

### Gate B：角色质量与互动（PET-04–PET-06）

- 宠物窗口 DOM 中不再出现 Emoji 字符。
- 至少两只原创内置宠物通过视觉评审。
- 六个编码状态、强度和五类指针互动真实可见。
- 透明、拖拽、收展、点击穿透和 reduced-motion 均回归通过。

### Gate C：用户可扩展性（PET-07–PET-08）

- 设置页以 ListView 展示全部宠物并正确标识选中项。
- 用户能从本地 `.opet` 完成导入、选择、重启保持和移除。
- 创作者示例可按文档独立复现。
- 全量 verify、E2E、coverage 与三桌面平台冒烟均有真实报告。

## 15. 完成定义

只有同时满足以下条件才算完成本次重构：

- 默认宠物是原创自绘资产，不是 Emoji，也不是从 Codex 截图复制的素材。
- 宠物能直接响应用户和编码事件，且交互不会破坏高优先级状态。
- 设置页 ListView 能清楚展示、选择和管理当前可用宠物。
- 用户无需修改应用源码即可安装自己的 `.opet` 宠物包。
- 第三方包是无代码、无权限、路径隔离的数据包，恶意包测试通过。
- 旧用户偏好被迁移，现有窗口行为没有回归。
- 双语文案、测试、changelog、任务提交和最终报告全部符合仓库规范。
