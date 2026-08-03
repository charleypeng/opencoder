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
