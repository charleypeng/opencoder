# OpenCode Client App

A cross-platform desktop & mobile client for [OpenCode](https://opencode.ai), built with Tauri 2 and SolidJS.

> Status: **Planning** — design docs and implementation plan in `docs/`, code to be scaffolded.

## Vision

- **One codebase, five platforms**: macOS / Windows / Linux / iOS / Android
- **Dual-form UI**: a desktop shell (mouse + shortcuts) and a mobile shell (touch-first), sharing one component library
- **Multi-server management**: connect to multiple `opencode serve` instances with health checks, mDNS auto-discovery, and a server home page
- **Full API coverage**: stage-by-stage implementation of the entire OpenAPI spec (162 endpoints / 472 schemas, see `docs/api-coverage.md`)
- **Vibe coding**: a desktop mascot companion that reacts to coding events
- **i18n first**: English + Simplified Chinese from day one

## Tech Stack

| Layer | Choice |
|---|---|
| App framework | Tauri 2.x (Rust) |
| Frontend | SolidJS + TypeScript |
| Build | Vite 6 + `@solidjs/router` |
| Styling | Tailwind CSS v4 + CSS variable design tokens |
| API types | `openapi-typescript` generated from the OpenAPI 3.1 spec |
| Transport | Rust `reqwest` (REST + SSE + WebSocket) |
| Terminal | xterm.js over a Rust WebSocket/PTY channel |
| i18n | i18next + `solid-i18next` |
| Quality | ESLint + Prettier + clippy/fmt + husky/lint-staged |

## Repository Layout

```
opencode-client/
├── docs/               # Planning docs (plan, architecture, UI design, API coverage, tasks)
├── src/                # SolidJS frontend
├── src-tauri/          # Rust core (transport, connections, discovery, pet)
└── opencode.json       # opencode workspace config
```

See `docs/architecture.md` for the full structure and `docs/PLAN.md` for the implementation plan.

## License

[MIT](LICENSE)
