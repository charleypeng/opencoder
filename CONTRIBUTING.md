# Contributing

Thanks for considering contributing to opencode-client. This project is MIT-licensed and developed in the open — issues, PRs, and feedback are all welcome.

## Development Setup

Prerequisites: Node.js >= 20, pnpm, Rust toolchain.

```bash
pnpm install      # install dependencies
pnpm tauri dev    # run the desktop app in dev mode
```

## Branch Policy

The `main` branch is protected. Work on a task branch named after the task card:

```bash
git checkout -b task/M2-03-session-list
```

Each task card (`docs/tasks/M*.md`) is completed as one task, one commit, one branch. Branches are merged back at milestone boundaries after review.

## Commit Conventions

Conventional Commits — one commit per task:

```
feat(chat): stream-render text and reasoning parts (TASK-M2-04)
fix(api): normalize error shape from Rust transport (TASK-M2-02)
docs: update README quick start (TASK-M0-08)
```

| Type       | Use for                                       |
| ---------- | --------------------------------------------- |
| `feat`     | New feature (requires both CHANGELOG entries) |
| `fix`      | Bug fix (write a reproducing test first)      |
| `test`     | Test-only additions                           |
| `chore`    | Infrastructure / dependencies / config        |
| `docs`     | Documentation                                 |
| `refactor` | Refactoring with no behavior change           |

## Testing Discipline

Run the full quality gate before committing — it must pass end to end:

```bash
pnpm verify
```

The gate runs lint, formatting, type checks, unit tests, mock server self-tests, and API codegen drift detection. Never skip or `describe.skip` failing tests.

## Agent Execution Manual

This repository is developed by AI agents following [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md) — it defines the task card format, the agent execution loop (read → implement → test → changelog → commit → report), module ownership for parallel work, and the milestone review gate. Human contributors are welcome to follow the same conventions.

## Code of Conduct

Please follow the [GitHub Community Code of Conduct](https://docs.github.com/en/site-policy/github-terms/github-community-code-of-conduct) in all interactions.
