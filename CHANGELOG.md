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
- Server navigation home: app landing page with a responsive server card grid (name/URL/status light/version/latency/last connected), live updates via `servers-changed` and `server-health` events, a context menu (and menu button) for edit / reconnect / delete with confirmation, an edit mode for the Add Server wizard (`update_server`), and an empty state guide (TASK-M1-06)
- mDNS LAN auto-discovery: Rust scan of `_opencode._tcp` (plus the `_http._tcp` advertisement of `opencode serve --mdns`) with per-instance dedupe, `server-discovered` events and idempotent `start_mdns_discovery` / `stop_mdns_discovery` / `get_discovered_servers` commands, silent degradation when the LAN is unreachable, plus a "Nearby servers" section in the Add Server wizard with one-click prefill and auto-probe (TASK-M1-07)
- Server workspace shell: three-column desktop skeleton (server rail with per-server health dots and ⌘/Ctrl+1..9 quick switching, sidebar, main pane) replacing the placeholder view, an active-server registry store that scopes the context for per-server stores (isolation on switch), SSE disconnect hook point on leave (wired in M2), and a mobile shell placeholder for M7 (TASK-M1-08)
- Credential re-auth and connection error handling: classified error copy (`errorTitle`/`errorDetail`) centralized in `services/errors.ts` for 401/network/timeout/5xx/invalid-url/cancelled/invalid-response, a dismissable `ErrorBanner` for ServerHome load and reconnect failures, a 401-triggered credential re-entry dialog that verifies new credentials with a probe before persisting them (`update_server`), and TS-side probe response validation rejecting non-health payloads as `invalid_response` (TASK-M1-09)
- Project/session/message domain service layer: factory-form typed services (`createProjectService` / `createSessionService` / `createMessageService`) over the ApiClient covering `/project`, `/project/current`, `/path`, session CRUD (`/session` GET/POST, `/session/{id}` GET/PATCH/DELETE), `/session/status`, message history with `limit`/`before` pagination (`/session/{id}/message`), `prompt_async` and `abort`, with schema-derived types and ApiError passthrough; mock server extended with `/path`, `/session/status`, create/update/delete, `prompt_async` (204), `abort`, and `limit`-aware message pagination, plus fixture fallback across fixture roots (TASK-M2-01)
- SSE event routing and normalized stores: per-server session store (list/order/statuses/active id), normalized messages store (`parts: Record<id, Part>` + `order`, O(1) delta appends, text stub on delta-before-part, part/message removal), project store (project list + active directory), and the `events.ts` router mapping `session.*` / `message.*` / `message.part.*` events into the stores, with `syncAll` full re-sync (session list + status map + projects + current directory) triggered by `server.connected` via `subscribeToServerEvents`, driven by the happy-chat mock scenario in L1 tests (TASK-M2-02)
