# CLAUDE.md

Instructions for Claude Code operating in the `anamnesis-standalone` repo.

## Git Workflow

`main` is protected. `.github/workflows/ci.yml` runs a `branch-gate` job on every
PR that rejects any head branch not prefixed `release/` or `hotfix/` — a plain
`feat/*`, `fix/*`, or `refactor/*` branch will fail CI even if the code is fine.
Branch protection requires both `branch-gate` and `ci` (typecheck + build) to pass
before merging.

- **`hotfix/<slug>`** — the default lane for a single, self-contained change
  (bug fix, refactor, small feature). Branch off `main`, PR back to `main`.
- **`release/<slug>`** — for aggregating a batch of related work before it lands
  on `main` in one PR. Not currently in use; reach for it only if you're
  deliberately staging several changes together.

There is no automation that creates `release/*` branches — if a task branch
isn't a hotfix, create the `release/*` branch by hand and target it with the
component PRs before the final PR into `main`.

Renaming an already-pushed branch to fit the prefix (rather than editing the
gate) is the expected fix when a PR fails `branch-gate`:

```
git branch -m <old-name> hotfix/<slug>
git push -u origin hotfix/<slug>
git push origin --delete <old-name>
gh pr create ...   # then close the superseded PR with a pointer to the new one
```

## Versioning & Releases

Version bumps and tags are handled by the manual `Release` workflow
(`.github/workflows/release.yml`), not by hand-editing `package.json`:

1. Trigger it via `workflow_dispatch` with a semver `version` input.
2. It validates the version is a well-formed semver greater than the latest
   tag, bumps `package.json` in the root and both packages, commits directly
   to `main`, and pushes a `v<version>` tag.
3. The tag push triggers `.github/workflows/publish.yml`, which drafts a GitHub
   release (changelog auto-generated from commits since the previous tag) and
   builds/uploads installers for Linux, macOS, and Windows.

`.github/workflows/build.yml` is a separate manual-only workflow for building
installers to test without creating a release or draft.

## CI

`.github/workflows/ci.yml`'s `ci` job runs on every PR/push to `main`:
`pnpm typecheck`, then `pnpm --filter @anamnesis/core build` and
`@anamnesis/app build:main`/`build:renderer`. Run these locally before opening
a PR to catch failures before CI does.
