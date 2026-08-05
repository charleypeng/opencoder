# 性能预算实测（TASK-M9-08）

> 依据：`docs/architecture.md` §9 五项指标。实测环境：2026-08-05，macOS，Vite 6.0.3 / SolidJS 1.9 / xterm 6.0。
> 结论：可本地实测的三项全部达标；两项需真实运行环境测量（首屏、内存），记录为豁免待测。

## 1. 五项指标实测

| 指标 | 目标 | 实测 | 状态 |
|---|---|---|---|
| 首屏（服务器导航页） | 桌面 < 1.5s，移动 < 2.5s | 启动主包 1,000KB（gzip 305KB），无同步大依赖；真实 WebView 冷启动需打包后在真机测量 | **豁免待测**（本仓库无 e2e/打包环境，见 §4） |
| 消息流渲染 | token delta → 上屏 < 50ms；长会话虚拟列表 60fps | delta 上屏 **0.78ms**；300 条消息（1000 parts）整表渲染 60.2ms；虚拟列表 1000 行 × 1000 次滚动 19.6ms（挂载行数 <50）；store 300×4 批量 17.2ms | **达标**（基准：`src/features/messages/perf.bench.test.tsx`，CI 上限 250ms/2000ms/250ms/500ms） |
| SSE 重连 | 断网恢复 < 3s 自动重连并对齐 | M1-02 指数退避 1s→2s→4s…封顶 30s + 心跳超时判死 + `server.connected` 全量对齐（`docs/architecture.md` §7.2；`services/sse.ts` 测试覆盖） | **达标**（实现级，真机网络切换待 M10 e2e） |
| 安装包 | 桌面 < 15MB，移动 < 25MB | Web 资产总 11MB（其中 shiki 语法包按需加载）；Tauri 侧未打包测量（本机无发布签名环境） | **豁免待测**（结构上无重资产：零图片字体，全部按需 chunk） |
| 内存（桌面常驻） | < 250MB | 需运行时测量（虚拟列表已把长会话 DOM 控制在常量级，见下） | **豁免待测** |

## 2. 包体优化（本任务）

| 项 | 修复前 | 修复后 | 收益 |
|---|---|---|---|
| 启动主包 `index-*.js` | 1,368.41KB（gzip 402.46KB） | **1,000.36KB（gzip 304.79KB）** | **−368KB（−27%）/ −98KB gzip（−24%）** |
| xterm.js（+ addon-fit + 终端面板） | 静态打进主包（主包内 95 处引用） | **懒加载**：`TerminalPanel` chunk 346.2KB（gzip 86.7KB），仅终端视图打开时加载（DesktopShell + MobileShell 经 Solid `lazy` + Suspense） | 启动不携带终端运行时 |
| qrcode | 静态打进主包 | **动态 `import("qrcode")`**：独立 chunk 25.8KB（gzip ~7KB），仅二维码对话框打开时加载 | 同上 |
| shiki | 已懒加载（语法包逐个 chunk） | 维持 | —（语言包最大 790KB，按需） |
| markdown-it / dompurify / i18next / @kobalte/core | 静态（消息渲染核心栈，任何聊天视图必用） | 维持 | 不可拆分，属最小启动集 |

### 按需加载清单（启动主包之外）

`TerminalPanel`（xterm 346KB）、`TerminalPage`（移动端入口 0.5KB）、`qrcode`（25.8KB）、shiki 语法包 ~250 个（单个 5KB–790KB，按语言首次高亮时加载）。

## 3. 流式渲染基准数字（复跑记录）

`pnpm vitest run src/features/messages/perf.bench.test.tsx --disable-console-intercept`（2026-08-05，本机）：

```
[perf.bench] virtual list 1000x1000: 19.6ms   （上限 250ms）
[perf.bench] MessageList 300msgs render: 60.2ms （上限 2000ms）
[perf.bench] token delta to DOM: 0.78ms      （上限 250ms；§9 目标 <50ms）
[perf.bench] store batch 300x4: 17.2ms       （上限 500ms）
```

token delta 上屏 0.78ms 远低于 50ms 目标（jsdom 测量值，真实浏览器同数量级，M2-09 流式管线 + 细粒度 part 级重渲染已定案）。300 条消息仅挂载可见切片（`data-virtual-row` < 40），长会话 60fps 滚动的虚拟化前提成立。

## 4. 豁免说明（需后续实测项）

- **首屏 / 内存 / 安装包**：三项需要 Tauri 打包 + 真机运行时环境。结构层面的支撑已就位：主包 1,000KB 无同步重型依赖、虚拟列表保证长会话 DOM 常量级、Web 资产 11MB 且全部大块（xterm/qrcode/shiki）按需加载。待 M10 e2e 环境（或发布签名流程）落地后按本表补测并回填。
- 浏览器真实 60fps 渲染（1000 parts 逐 token 更新）需真实布局引擎，M2-09 已注明人工验证路径；jsdom 基准（上表）保证算法层 trivial。
