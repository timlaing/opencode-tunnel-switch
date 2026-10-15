# Contributing

Use a feature branch and open a pull request into `main`. Keep changes focused and credentials out of issues, logs and examples.

## Development

Use Node.js 24 and Bun 1.4.3 (the CI-pinned runtime for packed-plugin verification). In a checkout separate from a running OpenCode instance:

```sh
npm ci --prefix plugin
```

Install and run the external [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch) server separately. Point OpenCode at the checkout's absolute `plugin` directory. Its root `index.ts` re-exports `src/index.ts`; no compilation step is required. Reload after source changes.

Use the repository's configured no-reply email and GPG key for signed commits. Check `git log -1 --show-signature` before pushing. Do not commit live configuration, `.npmrc`, tokens or generated archives.

## Verification

```sh
npm run check --prefix plugin
npm test --prefix plugin
bun --conditions=browser plugin/scripts/verify-tui.ts
```

GitHub CodeQL default setup scans JavaScript/TypeScript and Actions workflows.
The active ruleset requires its security analysis; keep CodeQL enabled when
maintaining that rule.

CI runs plugin types, tests and LCOV coverage on Node.js 24, plus the OpenTUI renderer verification on Bun. The renderer verification can also run locally on Node.js 26 with `npm run test:tui --prefix plugin`. Tests cover API requests, error matching, retry decisions, discovery, environment leases and publishing helpers. Python server, proxy and SSH integration tests belong to the server repository.

To verify the packed plugin with Bun installed, run from `plugin`:

```sh
npm pack --json > /tmp/tunnel-switch-plugin-pack.json
bun scripts/verify-package.ts /tmp/tunnel-switch-plugin-pack.json
```

OpenCode SDK is pinned to `@opencode/plugin` 2.0.29. Local application loading was previously verified with OpenCode v2.0.25; CI does not launch the full application. See [troubleshooting](docs/troubleshooting.md) for discovery checks.

## Releases

Update `CHANGELOG.md`, `plugin/package.json` and its lockfile for a plugin release. Run verification, create a signed `plugin-v<version>` (or `v<version>`) tag on the approved revision, then publish a matching GitHub release. The `Publish plugin` workflow verifies and publishes the packed archive to public GitHub Packages and reads it back for validation. Manual dispatch publishes the version on `main`. Published versions are immutable; confirm the workflow and registry result before announcing availability.

Python distributions and server releases are managed in `ssh-tunnel-switch`. This repository no longer builds combined install bundles. See the [package guide](plugin/README.md) for authentication and publication details.

## Labels and triage

Issue forms set `bug` or `enhancement` and `needs-triage`. Automation adds a
component label from the bug form. Maintainers remove `needs-triage` after
review and can adjust labels manually. PRs receive labels from changed paths,
conventional title prefixes (`fix:`, `feat:`, `docs:`, `ci:`, `test:`, `build:`),
and Dependabot authorship. Automatic labels are additive and preserve manual
labels. The label definitions are in [.github/labels.json](.github/labels.json).

## Inactive work

Daily maintenance marks issues stale after 60 inactive days and PRs after 30,
then closes them after 14 further inactive days. New activity removes `stale`.
Draft PRs, items with milestones, and items labeled `keep-open`, `security`, or
`priority: high` are exempt. Stale closure does not indicate a fix. Items can
be reopened, and stale PR branches are retained.

## Main branch protection

The intended ruleset is [.github/rulesets/main.json](.github/rulesets/main.json):
PRs only, one approving review, dismissal of stale approvals, approval after
the latest push by someone other than its author, resolved review threads,
the plugin CI job passing against an up-to-date branch, linear history, no
force pushes or deletion, and no bypass actors. Review requires a second
person; PR authors cannot approve their own changes.

The public repository has an active `main` ruleset. The JSON file describes the
intended policy; inspect Settings → Rules → Rulesets for the currently enforced
checks and reviews. Keep required check names synchronized with CI when jobs are
renamed or removed. An administrator can apply the intended policy with:

```sh
gh api --method POST repos/timlaing/opencode-tunnel-switch/rulesets \
  --input .github/rulesets/main.json
```

Squash/rebase merging and automatic deletion of merged branches are enabled
in repository settings. Dependency-audit checks are conditional on changed
paths, so they are not required checks in the ruleset.

## SonarQube analysis

The `SonarQube` workflow follows successful `CI` runs for main pushes and same-repository pull requests. Fork PRs still run unprivileged CI but do not receive credentialed scans; maintainers can move reviewed changes onto a branch in this repository to obtain a scan. CI uploads plugin LCOV coverage; the scan downloads artifacts from that exact run and waits for the quality gate. It uses trusted workflow arguments, removes PR-controlled scanner properties, and does not execute repository code with the Sonar credential. `sonar-project.properties` documents the same source/test layout for local analysis.

Project: `timlaing_opencode-tunnel-switch`, organization: `timlaing`, service: `https://sonarcloud.io`. Enable GitHub variable `SONAR_ENABLED=true` and supply Actions secret `SONAR_TOKEN` only after the Sonar project exists with matching visibility. Disable Sonar automatic analysis when using this CI workflow. A missing credential fails an enabled scan; disabled scanning is explicitly skipped.

For this public repository, create or import a public Sonar project with the key
above, configure its CI token, and set `SONAR_ENABLED=true` to activate scanning.
Repository visibility alone does not create or enable a Sonar project.
