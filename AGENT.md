# AGENT.md

Detailed reference for the git workflow, CI, and release process in
`anamnesis-standalone`. `CLAUDE.md` has the short version and links here for
the mechanics — read this when you need the actual steps.

## Git Workflow

`main` is protected by a repository ruleset: all changes require a PR (no
direct pushes, even from `github-actions[bot]`), and `.github/workflows/ci.yml`
runs a `branch-gate` job on every PR that rejects any head branch not prefixed
`release/` or `hotfix/` — a plain `feat/*`, `fix/*`, or `refactor/*` branch
fails CI even if the code is fine. Both `branch-gate` and `ci` (typecheck +
build) must pass before merging.

- **`hotfix/<slug>`** — the default lane for a single, self-contained change
  (bug fix, refactor, small feature, docs). Branch off `main`, PR back to
  `main`.
- **`release/<slug>`** — for aggregating a batch of related work before it
  lands on `main` in one PR. Not currently in use; reach for it only if
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

The ruleset has a bypass list (a repository role plus one specific user) for
emergencies, but automation (the `Release` workflow's `github-actions[bot]`
token) is deliberately **not** on it — see Releasing below for why that
matters and how the workflow works around it without needing a bypass.

## Releasing

Cutting a release means running the `Release` workflow
(`.github/workflows/release.yml`) **twice**, because `main`'s ruleset forces
the version bump through a PR — the workflow can't just push it:

1. **First dispatch** — bumps the version, opens a PR, stops:
   ```
   gh workflow run release.yml -f version=X.Y.Z
   ```
   This validates `X.Y.Z` is a well-formed semver greater than the latest tag,
   bumps `package.json` in the root and both packages, and opens a
   `hotfix/release-vX.Y.Z` PR with that change. It does **not** merge its own
   PR — no auto-merge, on purpose, so a version bump gets the same human
   review as any other change to `main`.
2. **Merge that PR** (squash — `main` requires linear history) once its
   checks (`ci`, `branch-gate`) pass.
3. **Second dispatch, same version** — tags and triggers the build:
   ```
   gh workflow run release.yml -f version=X.Y.Z
   ```
   The workflow sees `package.json` is already at `X.Y.Z` (the PR merged),
   skips the bump/PR step, and pushes the `vX.Y.Z` tag directly — tags aren't
   covered by the branch ruleset, so this push doesn't need a PR.
4. The tag push triggers `.github/workflows/publish.yml`: it drafts a GitHub
   release (changelog auto-generated from commits since the previous tag) and
   builds/uploads installers for Linux (`.deb`, `.AppImage`), macOS (`.dmg`),
   and Windows (`.exe`). Takes roughly 5–10 minutes for all three platform
   builds.
5. **The release lands as a draft.** Before publishing:
   - Sanity-check the assets — `gh release view vX.Y.Z --json assets` — all
     should show `"state": "uploaded"`, and sizes should be in the same
     ballpark as the previous release (a truncated/near-zero-byte asset means
     a build step failed silently).
   - Replace the auto-generated commit-log body with real user-facing release
     notes (grouped as Improvements/Fixes, not a raw `git log`).
   - Publish:
     ```
     gh release edit vX.Y.Z --draft=false --notes "..."
     ```

`.github/workflows/build.yml` is a separate manual-only workflow for building
installers to test without creating a release or draft — use it when you just
want to sanity-check a packaged build, not cut a release.

## CI

`.github/workflows/ci.yml`'s `ci` job runs on every PR/push to `main`:
`pnpm typecheck`, then `pnpm --filter @anamnesis/core build` and
`@anamnesis/app build:main`/`build:renderer`. Run these locally before opening
a PR to catch failures before CI does.
