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
