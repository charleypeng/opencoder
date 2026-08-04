# opencoder

A cross-platform desktop & mobile client for [OpenCode](https://opencode.ai), built with Tauri 2 and SolidJS.

> Status: **Planning** — milestone M0 (engineering foundation) done, M1+ in progress. See [docs/PLAN.md](docs/PLAN.md).

![Build status](https://img.shields.io/github/actions/workflow/status/charleypeng/opencoder/ci.yml?branch=main&label=CI)
[简体中文](./README-zh.md)

## Features

- **One codebase, five platforms**: macOS / Windows / Linux / iOS / Android
- **Dual-form UI**: a desktop shell (mouse + shortcuts) and a mobile shell (touch-first), sharing one component library
- **Multi-server management**: connect to multiple `opencode serve` instances with health checks, mDNS auto-discovery, and a server home page
- **Full API coverage**: stage-by-stage implementation of the entire OpenAPI spec (162 endpoints / 472 schemas, see [docs/api-coverage.md](docs/api-coverage.md))
- **Vibe coding**: a desktop mascot companion that reacts to coding events
- **i18n first**: English + Simplified Chinese from day one

## Tech Stack

| Layer         | Choice                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| App framework | Tauri 2.x (Rust)                                                         |
| Frontend      | SolidJS + TypeScript                                                     |
| Build         | Vite 6 + `@solidjs/router`                                               |
| Styling       | Tailwind CSS v4 + CSS variable design tokens                             |
| Components    | Kobalte (accessible headless components)                                 |
| API types     | `openapi-typescript` generated from the OpenAPI 3.1 spec                 |
| Transport     | Rust `reqwest` (REST + SSE + WebSocket), WebView never connects directly |
| Terminal      | xterm.js over a Rust WebSocket/PTY channel                               |
| State         | Solid stores, sliced per server                                          |
| i18n          | i18next + `solid-i18next`                                                |
| Mascot        | Rive animations in a separate transparent window (desktop)               |
| Quality       | ESLint + Prettier + clippy/fmt + husky/lint-staged                       |

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                  SolidJS Frontend (one codebase)          │
│  Desktop Shell · Mobile Shell · Shared Features           │
│  Stores (per server) ← Services (API abstraction)         │
│               ApiClient / SSE facade (TS)                 │
└───────────────────────────┬───────────────────────────────┘
                    Tauri IPC (invoke / Channel)
┌───────────────────────────▼───────────────────────────────┐
│                     Rust Core (src-tauri)                 │
│   transport: http (REST) · sse · ws (PTY)                 │
│   connections · health monitor · mDNS discovery           │
│   pet window · glass plugin (iOS/macOS)                   │
└───────────────────────────┬───────────────────────────────┘
                 HTTP / SSE / WebSocket (reqwest)
      opencode serve (local)    (LAN / mDNS)    (remote)
```

All network traffic to OpenCode servers flows through the Rust transport layer (ADR-002), which avoids WebView CORS restrictions and iOS ATS blocks, and keeps SSE/WebSocket connections alive independently of the WebView lifecycle. See [docs/architecture.md](docs/architecture.md) for details.

## Getting Started

Prerequisites: Node.js >= 20, pnpm, and a Rust toolchain (for desktop builds).

```bash
pnpm install        # install dependencies
pnpm tauri dev      # run the desktop app in dev mode
```

Useful scripts:

| Command              | Purpose                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm verify`        | Quality gate: lint + format + typecheck + tests + codegen drift (must pass before commit) |
| `pnpm test`          | Unit tests (vitest)                                                                       |
| `pnpm mock:start`    | Start the Mock OpenCode Server (Node, REST + SSE + scenarios)                             |
| `pnpm mock:test`     | Mock server self-test                                                                     |
| `pnpm gen:api`       | Regenerate API types from the OpenAPI contract                                            |
| `pnpm gen:api:check` | Drift-check committed types against the contract (used in CI)                             |

### API Contract & Type Generation

- Source of truth: `docs/openapi_v1.18.11.json` (OpenAPI 3.1, version-locked)
- Generated types: `src/services/api/schema.d.ts` (via `openapi-typescript`, script `scripts/gen-api.mjs`)

Contract upgrade flow: replace the versioned spec file → `pnpm gen:api` → `pnpm gen:api:check` → `pnpm exec tsc -b` → commit both files.

## Documentation

| Doc                                              | Contents                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| [docs/PLAN.md](docs/PLAN.md)                     | Overall plan, milestones, decision points                   |
| [docs/architecture.md](docs/architecture.md)     | Technical architecture, directory layout, data flows        |
| [docs/api-coverage.md](docs/api-coverage.md)     | 162 endpoints → feature domain → priority/milestone mapping |
| [docs/ui-design.md](docs/ui-design.md)           | Design system, desktop/mobile shells, Liquid Glass, mascot  |
| [docs/testing.md](docs/testing.md)               | Layered test strategy, Mock Server, CI                      |
| [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md) | Agent execution manual (task card format, commit rules)     |
| [docs/tasks/M0.md … M10.md](docs/tasks/M0.md)    | Executable task cards (83 total)                            |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch and commit conventions, and testing discipline.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE)
