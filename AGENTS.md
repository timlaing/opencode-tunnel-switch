# AGENTS.md

Quick reference for AI agents. Human-facing workflow, rationale and history live in [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md). Every command below was run from the repo root as written.

## Repository shape

- One deliverable: the OpenCode plugin in `plugin/`. There is no root `package.json`, so npm commands need `--prefix plugin` or must run from `plugin/`.
- No build step — OpenCode loads the TypeScript directly. `plugin/index.ts` and `plugin/tui.ts` are one-line shims re-exporting `src/index.ts` / `src/tui.ts` for OpenCode's directory loader; keep both in sync with their `src/` counterparts.
- Real source: `plugin/src/{index,client,status,discovery,environment,tui}.ts`, tests in `plugin/test/*.test.ts` (built-in `node:test` runner executed through tsx).
- Root-level `src/`, `tests/`, `deploy/`, `.venv/`, `.pytest_cache/` are untracked leftovers of the Python server, which moved to github.com/timlaing/ssh-tunnel-switch. They are empty or near-empty; don't treat them as source or "clean them up" in a code PR.
- No linter or formatter is configured. `tsc` + tests are the gate.

## Commands

- Setup: `npm ci --ignore-scripts --prefix plugin`. Always keep `--ignore-scripts`; CI uses it and no dependency needs lifecycle scripts.
- CI's gate, in order: `npm run check --prefix plugin` → `npm test --prefix plugin` → TUI check below.
- TUI/renderer check: `npm run test:tui --prefix plugin` (works on Node 26; CI runs the equivalent under pinned Bun 1.4.3). Bun is **not installed in this environment**, so the packed-plugin check `npm run verify:package` cannot run locally — leave it to CI.
- Single test file: `cd plugin && node --import tsx --test test/client.test.ts`. `npm test` runs the whole `test/*.test.ts` glob.
- Coverage: `npm run test:coverage --prefix plugin` writes `plugin/coverage/lcov.info` with `plugin/`-relative `SF:` paths. Sonar expects repo-root paths; CI rewrites them with `sed -i 's|^SF:|SF:plugin/|' coverage/lcov.info` before upload. Replicate that step if comparing local coverage to Sonar.

## Conventions

- Commits are GPG-signed automatically (`commit.gpgsign=true` with a configured key); check `git log -1 --show-signature` before pushing. Never commit `.npmrc`, tokens, `*.tgz`, or live config.
- PR titles use conventional prefixes (`fix:`, `feat:`, `docs:`, `ci:`, `test:`, `build:`); the label workflow derives labels from them plus changed paths.
- Changelog: working entries go under `## Unreleased` in CHANGELOG.md; release headings follow `## [<version>] - <YYYY-MM-DD>` (e.g. `## [1.2.0] - 2026-10-15`). If a past release section is missing, backfill it instead of folding old entries into the new release.
- Release: bump `plugin/package.json` and the lockfile (`npm install --package-lock-only --ignore-scripts` in `plugin/`), update the changelog, merge, then tag the merge commit `v<version>` and publish a GitHub release to trigger the Publish plugin workflow. The workflow accepts only exact `v<version>` tags (manual dispatches are exempt); published versions are immutable.
- Keep the `overrides: { "seroval": "^1.6.9" }` in `plugin/package.json` until OpenTUI's Solid constraint resolves a patched serializer; dropping it reintroduces the vulnerable `~1.5.x`. Verify override changes with `npm audit` plus the TUI check.

## Packaging helpers

- `verify:package` / `publish:package` / `verify:published` read pack JSON from **stdin**: run them as `npm run verify:package < pack.json` from `plugin/`. They spawn npm through the parent's absolute `npm_execpath` and throw if it is missing or relative; invoking the scripts directly (or passing a manifest path, the pre-1.2.0 interface) fails or hangs on stdin.
- `plugin/scripts/verify-package.ts` enforces the published-file allowlist. Adding a new package-root file (anything beyond `index.ts`, `tui.ts`, `src/**` plus LICENSE/package.json/README.md) fails verification until that allowlist is updated.
- Publishing tests deliberately spawn with `PATH=/nonexistent` and a fake `npm_execpath`; that guards against PATH-based npm resolution — don't "fix" it back.

## Getting changes onto main

- `main` is guarded by a **live** ruleset: required checks `Plugin types and tests`, `CodeRabbit` (may show `pass 0` with "Review rate limited" — still green), `Plugin dependency vulnerabilities`; strict up-to-date branch; approval by someone other than the last pusher; resolved review threads; squash-only, linear history; no force pushes. It also blocks on CodeQL alerts and code-quality errors.
- `.github/rulesets/main.json` and the description in CONTRIBUTING.md are the _intended_ policy and currently differ from what is enforced (e.g. it lists a single required check). When it matters, trust `gh api repos/timlaing/opencode-tunnel-switch/rulesets`.
- A solo author cannot satisfy the last-push approval, so plain `gh pr merge` fails; the maintainer's account has bypass rights and authorizes `--admin` merges case by case.
