# 变更记录

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- Tauri 2 + SolidJS 工程脚手架，devtools 仅限 debug 构建启用 (TASK-M0-01)
- 设计令牌与 Tailwind CSS v4 基座，支持深浅色主题切换 (TASK-M0-02)
- OpenAPI 类型生成管线：`openapi-typescript` 从版本锁定契约生成类型，带漂移检测 (TASK-M0-03)
- Mock OpenCode Server REST 骨架：健康检查 / 项目 / 会话端点、故障注入、可选 Basic Auth (TASK-M0-04)
- Mock Server SSE 流与场景脚本：happy-chat、permission-flow、question-flow、sse-drop (TASK-M0-05)
- 真实响应样本 fixtures，含录制脚本与 schema 校验 (TASK-M0-06)
- CI 流水线与 `pnpm verify` 质量门禁，husky + lint-staged 提交前钩子 (TASK-M0-07)
- 双语工程文档骨架：README / CHANGELOG（中英）+ CONTRIBUTING (TASK-M0-08)
- Rust REST 传输通道（reqwest/rustls、Basic Auth、超时、取消、错误分类）与 TS ApiClient 门面（invoke/fetch 双传输实现）(TASK-M1-01)
- Rust SSE 订阅管理器（跨 chunk 逐行解析、`tui.*`/`workspace.*` 事件过滤、16ms 批刷 Channel 推送、指数退避重连、心跳判死）与 TS 订阅门面（tauri Channel 封装）(TASK-M1-02)
- Rust 服务器注册表：持久化 CRUD commands（`list_servers`、`add_server`、`update_server`、`remove_server`、`resolve_server_base_url`），基于 tauri-plugin-store，带 `servers-changed` 同步事件；传输通道改为经由注册表解析服务器地址 (TASK-M1-03)
- Rust 健康监控器：每服务器独立 15s `GET /global/health` 轮询（复用 REST 传输层），记录延迟与版本，连续 3 次失败判定 down 并支持恢复，状态变化经 `server-health` 事件推送前端；新增 SolidJS 连接 store 同步健康快照 (TASK-M1-04)
- 添加服务器向导：名称/URL/可选认证表单，URL 规范化、实时「测试连接」探测（显示版本/延迟）、明文 HTTP 风险提示，保存走注册表 commands；并为注册表 commands 新增类型化 TS 封装 (TASK-M1-05)
- 服务器导航首页：App 启动落点，响应式服务器卡片网格（名称/URL/状态灯/版本/延迟/最近连接），经 `servers-changed` 与 `server-health` 事件实时更新；卡片右键菜单（含菜单按钮）提供编辑/重连/删除（二次确认）；添加服务器向导支持编辑模式（`update_server`）；空状态引导页 (TASK-M1-06)
