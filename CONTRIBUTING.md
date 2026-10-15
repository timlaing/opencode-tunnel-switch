# Contributing

Use a feature branch and open a pull request into `main`. Keep changes focused,
include relevant validation in the PR template, and keep credentials out of
issues, logs and examples. Development setup and required checks are below.

## Development

Use Python 3.12+, Node.js 24 and the CI-pinned Bun runtime. Install dependencies
in a virtual environment and a checkout separate from a running OpenCode instance:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]' build
npm ci --prefix plugin
```

For source development, clone the repository and run the commands above from its
root. Copy `examples/config.yaml` to ignored `config.yaml`, then configure it and
run `.venv/bin/tunnel-switch serve --config config.yaml`. Point OpenCode's plugin
tuple at the checkout's absolute `plugin` directory. OpenCode loads the root
`plugin/index.ts`, which re-exports `src/index.ts`; there is no compilation step.
A manifest export pointing only to nested source is insufficient for the local
loader. Reload the plugin after source changes.

Use the repository's configured no-reply email and GPG key for signed commits.
Check `git log -1 --show-signature` before pushing. Do not commit live YAML,
OpenCode config, `.npmrc`, registry tokens or generated package archives.

## Verification

After installing development dependencies, run:

```sh
npm run check --prefix plugin
npm test --prefix plugin
.venv/bin/python -m pytest -q
.venv/bin/python -m build
```

For plugin discovery failures, connection problems and diagnostic commands, use
the [troubleshooting guide](docs/troubleshooting.md). Keep verification procedures
in this guide and operational diagnosis in that document.

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

### CI coverage

CI runs plugin types/tests, Python service and HTTP/HTTPS proxy tests, real Bun
routing on Python 3.12–3.14 on Linux and 3.13 on macOS, real OpenSSH Docker tests,
and Linux systemd unit syntax verification. It builds and validates an installed
Python wheel. Dependency audits run on relevant changes, weekly and manually;
Dependabot covers Python, npm, GitHub Actions and the Docker test image.

The proxy suite covers streamed/chunked transfers, HTTPS certificate validation,
half-closes, framing rejection, limits and shutdown. Service tests cover YAML/CLI
validation, authorization, serialized rotation, cooldowns, cancellation, connection
identity and SOCKS readiness. Plugin tests cover endpoint/error matching, discovery,
process-wide environment leases and direct REST requests.

### Verified runtimes and limits

| Component | Requirement or verified version | Evidence and limits |
| --- | --- | --- |
| Python | 3.12+; CI tests 3.12, 3.13 and 3.14 on Linux | Full service, HTTP/HTTPS and Bun integration tests; macOS CI tests Python 3.13 |
| Node.js | CI uses 24 | Plugin type checks, tests and npm packaging; OpenCode loads the plugin through Bun |
| Bun | CI pins 1.4.3 | Real plugin setup, proxy environment routing and direct REST calls |
| OpenCode SDK | `@opencode/plugin` 2.0.29 | Pinned dependency; types and packed `Host.resolve`/`Host.load` checks |
| OpenCode application | Local loading verified with v2.0.25 | Plugin listed as active and command registered; CI does not launch the complete application |
| Linux | GitHub-hosted `ubuntu-latest` | Python/Bun integration tests; runner image changes over time |
| macOS | GitHub-hosted `macos-14` | Python 3.13 and proxy/Bun integration tests |
| OpenSSH | System `ssh` client with SOCKS forwarding | Linux CI runs real OpenSSH servers in disposable Docker fixtures, testing forwarding, rotation, host-key rejection, server loss and cleanup; deployment credentials still require target-host checks |
| systemd | Linux service example supplied | Unit syntax is checked in CI; deployment with real SSH credentials must be verified on its target host |
| Windows | No verification claimed | No Windows CI or native service example |

Package metadata sets the Python minimum and SDK pin; workflow files specify CI runtimes. Inspect the latest successful [CI run](https://github.com/timlaing/opencode-tunnel-switch/actions/workflows/ci.yml)
for evidence against the revision being deployed.


### Release bundle verification

With build, npm dependencies and Bun installed, generate the exact install bundle:

```sh
.venv/bin/python .github/scripts/build-release.py /tmp/tunnel-switch-release
```

The script builds Python wheel/sdist, verifies the installed packed plugin and
assembles only distribution files plus example configuration and guides. The
release workflow checks the checksum, verifies the bundled plugin lockfile matches
the source, installs its locked production dependencies with `npm ci`, and installs
the wheel into a fresh virtual environment. Never substitute live YAML or OpenCode configuration for examples.

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

`Release install bundle` builds both components from the release revision and
attaches `opencode-tunnel-switch-release.tar.gz` and `SHA256SUMS`. It also verifies
bundles on relevant PRs without attaching a release. Publish a GitHub release
only after its revision passes CI; wait for bundle attachment before sharing
installation instructions. Manual dispatch accepts an existing release tag and
checks out that tag, rather than the current main revision. Existing assets are
not overwritten; a duplicate upload fails and must be investigated. There is
currently no published GitHub release, so release installation becomes available
when this workflow is merged and the first release finishes.

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

## SonarQube analysis

The `SonarQube` workflow follows successful `CI` runs for main pushes and same-repository pull requests. Fork PRs still run unprivileged CI but do not receive credentialed scans; maintainers can move reviewed changes onto a branch in this repository to obtain a scan. CI uploads Python branch coverage and plugin LCOV coverage; the scan downloads artifacts from that exact run and waits for the quality gate. It uses trusted workflow arguments, removes PR-controlled scanner properties, and does not execute repository code with the Sonar credential. `sonar-project.properties` documents the same source/test layout for local analysis.

Project: `timlaing_opencode-tunnel-switch`, organization: `timlaing`, service: `https://sonarcloud.io`. Enable GitHub variable `SONAR_ENABLED=true` and supply Actions secret `SONAR_TOKEN` only after the Sonar project exists with matching visibility. Disable Sonar automatic analysis when using this CI workflow. A missing credential fails an enabled scan; disabled scanning is explicitly skipped.

Private scanning is prepared but disabled: the current Sonar organization does not support private projects. Enable private-project support, import this repository as a **private** Sonar project, add its CI token and set `SONAR_ENABLED=true` to activate. Do not upload this repository to a public Sonar project.
