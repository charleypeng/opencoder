# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tauri 2 + SolidJS project scaffold with devtools gated to debug builds (TASK-M0-01)
- Design tokens and Tailwind CSS v4 base with light/dark theme switching (TASK-M0-02)
- OpenAPI type generation pipeline: `openapi-typescript` from the version-locked contract, with drift detection (TASK-M0-03)
- Mock OpenCode Server REST skeleton: health / project / session endpoints, fault injection, optional Basic Auth (TASK-M0-04)
- Mock Server SSE streams and scenario scripts: happy-chat, permission-flow, question-flow, sse-drop (TASK-M0-05)
- Real-response sample fixtures with a recording script and schema validation (TASK-M0-06)
- CI pipelines and the `pnpm verify` quality gate, with husky + lint-staged pre-commit hooks (TASK-M0-07)
- Bilingual engineering docs skeleton: README / CHANGELOG (en + zh) and CONTRIBUTING (TASK-M0-08)
- Rust REST transport channel (reqwest/rustls, Basic Auth, timeouts, cancellation, error classification) and a TS ApiClient facade with dual invoke/fetch transports (TASK-M1-01)
- Rust SSE subscription manager (line parsing across chunk boundaries, `tui.*`/`workspace.*` event filtering, 16ms batched Channel pushes, exponential-backoff reconnect, heartbeat timeout) with a TS subscription facade over tauri Channels (TASK-M1-02)
- Rust server registry: persistent CRUD commands (`list_servers`, `add_server`, `update_server`, `remove_server`, `resolve_server_base_url`) backed by tauri-plugin-store, with `servers-changed` sync events; transport channels now resolve server base URLs through the registry (TASK-M1-03)
- Rust health monitor: per-server 15s `GET /global/health` polling through the REST transport, latency/version tracking, 3-strike down detection with recovery and `server-health` events to the frontend, plus a SolidJS connection store mirroring the snapshots (TASK-M1-04)
- Add Server wizard: name/URL/optional-auth form with URL normalization, a live "Test connection" probe (version + latency), a plain-HTTP risk warning, and save through the registry commands, with typed TS wrappers for the server registry commands (TASK-M1-05)
