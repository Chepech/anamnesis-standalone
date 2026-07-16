# CLAUDE.md

Instructions for Claude Code operating in the `anamnesis-standalone` repo.
See `AGENT.md` for the full mechanics behind each of these — this file is
just the summary.

## Git Workflow

`main` is protected: PRs only, and only from `hotfix/*` or `release/*`
branches (CI's `branch-gate` job rejects anything else, e.g. `feat/*`).
Default to `hotfix/<slug>` for a single self-contained change. See
`AGENT.md` § Git Workflow for the branch-rename recovery path when a PR
fails the gate.

## Releases

Cutting a release means running `.github/workflows/release.yml` **twice**
(it opens a version-bump PR and stops; merge it; re-run with the same
version to tag) — then publishing the resulting draft release with real
notes. See `AGENT.md` § Releasing for the exact commands.

## CI

Every PR/push to `main` runs typecheck + build. Run
`pnpm typecheck && pnpm build:core && pnpm --filter @anamnesis/app build:main && pnpm --filter @anamnesis/app build:renderer`
locally before opening a PR to catch failures before CI does.
