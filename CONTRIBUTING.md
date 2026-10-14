# Contributing

Use a feature branch and open a pull request into `main`. Keep changes focused,
include relevant validation in the PR template, and keep credentials out of
issues, logs and examples. See the [README](README.md#verification) for checks.

## Development

Use Python 3.12+, Node.js 24 and the CI-pinned Bun runtime. Install dependencies
in a virtual environment and a checkout separate from a running OpenCode instance:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]' build
npm ci --prefix plugin
npm run check --prefix plugin
npm test --prefix plugin
.venv/bin/python -m pytest -q
.venv/bin/python -m build
```

Install Bun to run the real integration test, or set `TUNNEL_SWITCH_TEST_BUN` to
its executable. Without it, that integration test is skipped. Local proxy tests
need permission to bind loopback sockets. Validate example YAML with
`.venv/bin/tunnel-switch validate --config examples/config.yaml`.

Run the opt-in real SSH suite with Docker running and `ssh`/`ssh-keygen` installed:

```sh
TUNNEL_SWITCH_TEST_SSH=1 .venv/bin/python -m pytest -q -m ssh_integration
```

It builds the digest-pinned Debian fixture in `tests/fixtures/ssh`, starts two
SSH containers per test on dynamically selected loopback ports, and generates
fresh test keys. No personal SSH configuration or credentials are used. Tests
verify forwarding through each server, rotation and process/socket cleanup,
strict host-key rejection with recovery, and recovery after losing an SSH server.
Containers and the tagged fixture image are removed on normal completion or test
failure. If the test runner is forcibly killed, remove its remaining containers
identified by `tunnel-switch.integration=true` after confirming none belong to
another active test run. Docker privileges are needed only on the test host.
The fixture's SSH configuration is test-only and must not be deployed.
Explicit opt-in fails if Docker/tools are unavailable; ordinary runs skip these
tests. Linux CI always enables them in the `Real SSH integration` job.

Use the repository's configured no-reply email and GPG key for signed commits.
Check `git log -1 --show-signature` before pushing. Do not commit live YAML,
OpenCode config, `.npmrc`, registry tokens or generated package archives.

## Releases

Python and plugin versions are independent. Update `CHANGELOG.md` for changes
and configuration migrations. Update compatibility claims only with evidence.

For a plugin release, update `plugin/package.json` and its lockfile version,
check the packed archive, and run all required CI checks. Published versions
are immutable. Create a signed tag `plugin-v<version>` on the approved revision
and publish a matching GitHub release; `Publish plugin` will test and publish
the archive. A generic `v<version>` tag is also accepted, but component-specific
tags avoid confusing Python and plugin versions. Manual dispatch publishes the
version currently on `main`. Check the final workflow result and registry version
before announcing availability. See the [package guide](plugin/README.md).

For a Python release, update `pyproject.toml`, build wheel/sdist, verify both
include `LICENSE`, and test the installed wheel's CLI. There is no PyPI publishing
workflow; distributions can be attached to a separately named `service-v<version>`
release. The plugin publisher skips `service-v` tags, so a service release does not
trigger an npm publication.

The source tree's plugin 0.1.2 adds licensing but has not yet been published.
Use published 0.1.1 until the next release is completed.

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
all seven CI jobs passing against an up-to-date branch, linear history, no
force pushes or deletion, and no bypass actors. Review requires a second
person; PR authors cannot approve their own changes.

GitHub currently rejects protection for this private repository because its
owner's plan does not support it. The JSON file is a configuration artifact,
not active protection. Once GitHub Pro is available, an administrator can
import it under Settings → Rules → Rulesets, or apply it with:

```sh
gh api --method POST repos/timlaing/opencode-tunnel-switch/rulesets \
  --input .github/rulesets/main.json
```

Squash/rebase merging and automatic deletion of merged branches are enabled
in repository settings. Dependency-audit checks are conditional on changed
paths, so they are not required checks in the ruleset.
