# i18n 术语表 / Glossary

Terminology contract for the en / zh-CN UI copy (TASK-M9-02). Every
translatable string lives in `src/i18n/en.json` + `src/i18n/zh-CN.json`
(namespaces per feature); components resolve them through `useT()`.

## Core terms

| English (en)     | 简体中文 (zh-CN) | Notes                                             |
| ----------------- | ---------------- | ------------------------------------------------- |
| session           | 会话             | A conversation with an agent.                      |
| prompt            | 提示词           | A user message sent to the agent.                  |
| permission (request) | 权限请求      | Agent asks to run a tool / access a resource.      |
| provider          | 模型服务商       | LLM provider (OpenAI, Anthropic, ...).             |
| model             | 模型             | A specific model of a provider.                    |
| agent             | 智能体           | The agent persona (build / plan / explore).        |
| server            | 服务器           | An OpenCode server the client connects to.         |
| command           | 命令             | Slash command (`/init`, `/compact`, ...).          |
| skill             | 技能             | Reusable capability referenced with `@`.           |
| message           | 消息             | A single transcript message.                       |
| context           | 上下文           | The conversation context (compaction etc.).        |
| terminal          | 终端             | The PTY/shell terminal panel.                      |
| fork              | 派生             | Forking a session or message point.                |
| share             | 分享             | Sharing a session via URL.                         |
| revert            | 回退             | Reverting a session to a message point.            |
| snapshot          | 快照             | A file-state snapshot at a step start.             |
| patch             | 补丁             | A unified diff / patch payload.                    |
| workspace         | 工作区           | The project directory bound to the session.        |
| branch            | 分支             | Git branch.                                        |
| todo              | 待办             | Session todo items.                                |
| question          | 提问             | Agent question with options / free text.           |
| toast             | 提示             | Transient notification card.                       |
| shortcut          | 快捷键           | Keyboard shortcut.                                 |
| pet               | 宠物             | The desktop companion pet window.                  |
| tray              | 托盘             | System tray.                                       |
| settings          | 设置             | Settings view.                                     |
| update            | 更新             | App / server update.                               |
| notification      | 通知             | System notification.                               |
| language          | 语言             | UI language.                                       |
| URL               | URL              | Kept as-is (universal term).                       |
| QR code           | 二维码           | QR code.                                           |
| OAuth             | OAuth            | Kept as-is (protocol name).                        |
| AGENTS.md         | AGENTS.md        | Kept as-is (filename).                             |
| CLI               | CLI              | Kept as-is (acronym).                              |
| API key           | API 密钥         | Provider credentials.                              |

## Style rules

- Technical tokens (URL, OAuth, CLI, AGENTS.md, code identifiers, keyboard
  combos like `⌘/Ctrl+Enter`) stay verbatim in both languages.
- Ellipsis suffixes (`…`) indicate in-flight actions: 连接中… / 保存中….
- Interpolation (`{{name}}`, `{{count}}`) keeps numbers and names in the
  right place; plural keys (`_one`/`_other`) cover English counts.
- Status chips keep the glossary wording: 在线/缓慢/离线/未知 for server
  health, 等待中…/运行中…/已完成/失败 for tool states.
- Error titles are classified in `src/services/errors.ts` via
  `errorTitleKey` (returns an i18n key); the raw server message renders
  verbatim as the detail line and is never translated.
