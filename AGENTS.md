# AGENTS.md

Guidelines for AI agents working in this repository.

## Language

- **All code comments must be written in English.** Never write comments in other languages.
- Code identifiers, commit messages, PR titles, and documentation in code (doc comments) are written in English.
- User-facing text (UI copy) is internationalized via i18n and may include any language.

## Project

- This is an open source project (MIT licensed) published on GitHub.
- The codebase is a Tauri 2 + SolidJS client for OpenCode. The contract is `docs/openapi_v1.18.11.json`.
- Do not commit secrets, local paths, or machine-specific configuration.

## Workflow

- Follow the conventions in `docs/PLAN.md` and `docs/architecture.md`.
- Run linters and formatters (ESLint, Prettier, cargo clippy/fmt) before finishing a task.
