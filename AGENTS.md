# AGENTS.md

Guidelines for AI agents working in this repository. These rules are binding —
read them before starting any task, and follow them through to the commit.

## Language

- **All code comments must be written in English.** Never write comments in other languages.
- Code identifiers, commit messages, PR titles, and documentation in code (doc comments) are written in English.
- User-facing text (UI copy) is internationalized via i18n and may include any language.

## Project

- This is an open source project (MIT licensed) published on GitHub (https://github.com/charleypeng/opencoder).
- The codebase is a Tauri 2 + SolidJS client for OpenCode. The API contract is `docs/openapi_v1.18.11.json` — never hand-write types, regenerate via `pnpm gen:api`.
- Do not commit secrets, private keys, local paths, or machine-specific configuration. The updater signing key lives outside the repo (`~/.tauri/opencoder.key`) and must never be committed.
- The full project conventions live in `docs/`: read `docs/PLAN.md` (plan + decisions), `docs/architecture.md` (layering, data flow), `docs/AGENT_PLAYBOOK.md` (task-card format and the agent execution loop), `docs/testing.md` (test pyramid and discipline), `docs/api-coverage.md` (endpoint priorities) and `docs/ui-design.md` (design tokens and UX rules) before touching a subsystem for the first time.

## Code of Conduct

1. **Think before coding.** State assumptions, surface tradeoffs, ask when a task is ambiguous. Do not silently pick an interpretation.
2. **Surgical changes only.** Touch only what the task requires; never "improve" adjacent code, comments, or formatting. Match existing style. Remove only what YOUR change made dead.
3. **Simplicity first.** Minimum code that solves the problem. No speculative features, no abstractions for single-use code.
4. **Comments in English, meaningfully placed.** Explain WHY, not what. No comment spam.
5. **i18n for every user-visible string.** All UI copy goes through `useT()`/`t("ns:key")` with keys added to BOTH `src/i18n/en.json` and `src/i18n/zh-CN.json` (key sets must stay identical; `pnpm check:i18n` enforces it).
6. **Work within your task's scope and module ownership.** One module directory per agent at a time (ownership table in `docs/AGENT_PLAYBOOK.md` §4); when a task genuinely needs changes outside its declared scope, STOP and report instead of expanding silently.
7. **Do not fabricate.** No invented API behavior, no fake test results, no claimed verification you did not run. Everything is verified against the OpenAPI contract or a real run.
8. **Honest status reporting.** Report what you completed, what you verified (with evidence), and what remains — including environmental blockers (e.g. missing SDK, no real device).

## Task Execution

- One task at a time, following the execution loop in `docs/AGENT_PLAYBOOK.md` §2: read the task card and the referenced docs → confirm prerequisites → implement within scope → write tests → run the full gate → update the changelogs → commit → report.
- A task card is self-contained (goal, prerequisites, scope, API endpoints, acceptance, tests, commit message). Follow it; deviations must be documented in the report.
- Write tests with the change (TDD where practical). Fixes need a reproducing test first.
- Respect the test pyramid in `docs/testing.md`: services/stores get L1 unit tests, components get L2 tests, new endpoints get L3 contract coverage against the Mock OpenCode Server (`pnpm mock:start` / `pnpm mock:test`), and core user journeys belong in the Playwright E2E suite (`pnpm test:e2e`).

## Verification Gate

Run the FULL gate before every commit — it must pass 11/11:

```bash
pnpm verify   # L0: eslint, prettier, tsc, cargo fmt, cargo clippy, i18n keys, links, hardcoded strings · L1: vitest · L3: mock:test · gen:api:check
```

- Fix all findings; never silence or weaken a check to make it pass.
- Also run `pnpm test:e2e` when the change touches chat/rendering/session flows.
- `pnpm test:coverage` keeps services/stores above the thresholds (lines/functions/statements ≥ 80%, branches ≥ 70%).

## Changelog Obligation (MANDATORY, before every commit)

Every user-visible change — every `feat`, `fix`, `refactor`, `perf`, and significant `chore`/`docs` change — MUST update BOTH changelog files in the SAME commit that contains the change:

- `CHANGELOG.md` (English) and `CHANGELOG-zh.md` (简体中文), in the `## [Unreleased]` section, under the matching subsection (`### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Security`; the Chinese file uses `### 新增` / `### 变更` / `### 修复` / `### 移除` / `### 安全`).
- One entry per change, with:
  - a `type(scope):` prefix matching the commit message (e.g. `feat(messages):`),
  - a short English summary of WHAT changed and WHY,
  - the attribution: `(TASK-<M>-<NN>)` when the change belongs to a milestone task card, otherwise the subsystem name — never leave the entry unattributed.
- The English and Chinese entries must describe the SAME change (translated, not paraphrased into something different).
- The `[Unreleased]` section must not contain stale entries: if your change supersedes or reverts an existing entry, amend or remove it.
- Keep a Changelog format (https://keepachangelog.com): no date on `[Unreleased]`; version sections get dates when the release task moves them.
- Merge/release chores (e.g. version bumps, tag prep) may skip entries only when nothing user-visible changed — say so in the commit body if you skip.

## Commit Convention

- **One logical change per commit** — do not mix multiple tasks or unrelated edits in one commit.
- Conventional Commits format: `type(scope): summary` with types `feat` / `fix` / `refactor` / `perf` / `test` / `chore` / `docs`. The summary is English, imperative, lowercase, no trailing period.
- Add the attribution in the message when applicable: `feat(messages): stream tool output (TASK-M3-01)`.
- Stage only the files of your change. Never commit build artifacts, lockfile noise from unrelated installs, `.DS_Store`, `opencode.json` (local config — keep untracked), or generated output that is supposed to stay out of git.
- The changelog files are part of the change's commit — update them BEFORE `git commit`, not after.
- Do not commit directly to a protected branch when the workflow says otherwise; the default flow is one commit per task on the current branch, pushed only when asked.

## Reporting

Finish every task with a written report: what was completed / how it was verified (commands + output) / the commit hash + message / deviations and leftovers. Deviations from a task card must be explained, not hidden.
