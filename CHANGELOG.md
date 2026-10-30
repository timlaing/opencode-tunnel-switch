# Changelog

This repository releases the OpenCode plugin. The Python server is now maintained
separately in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch).

## Unreleased

- Recover from npm's staged-version publish conflict by verifying instead of
  matching error text. npm accepts a publish into a staging area and only
  later exposes the version on its read path, so a `workflow_dispatch` rerun
  inside that window probes the version as missing (E404 or an empty view)
  and the re-upload collides with the version npm already staged — the 1.5.0
  release hit exactly this after the release-triggered run lost the
  propagation race, and the rerun failed at upload instead of at readback.
  Because published versions are immutable, any upload failure now triggers
  the same bounded readback (sharing the reader and
  `VERIFY_ATTEMPTS`/`VERIFY_RETRY_DELAY_MS` settings as the verify step) and
  the run continues only when that registry holds the exact tested artifact.
  For npmjs this means integrity, repository linkage and the provenance
  attestation; for GitHub Packages it means integrity and repository linkage
  (npm-style attestations are not accepted there). Nothing is classified from
  npm's error codes or wording (an unrelated `E409`, the staged wording under
  a foreign code, and a GitHub Packages failure all take the same path); a
  mismatch or a version that stays unreadable past the bound keeps the failure
  wrapped with the upload error, so no remaining registry ever receives an
  unretractable upload while another holds something unverified. The publish
  step in the workflow gets the same 11 attempts × 10s window as readback for
  that wait instead of the helper's 15s default. Interactive runs keep npm's
  stdio on the attached terminal so an OTP or login prompt keeps working:
  pack JSON arrives on stdin, so stdin is never a terminal — interactivity is
  judged by the attached terminal and npm reads prompts from the controlling
  terminal device (`/dev/tty`, or `CONIN$` on Windows), falling back to
  captured output when no terminal input device can be opened rather than
  handing npm the already-consumed stdin pipe.
- Apply the provenance gate to already-readable versions in the publish
  preflight as well, not only at readback: the probe now queries
  `dist.attestations.url` alongside integrity and repository metadata (npm
  projects field paths client-side, so an unattested version simply lacks
  the key), and a version that reached npm without a signed attestation
  aborts before another registry receives an unretractable upload — a
  staged-unattested run that is retried once the version surfaces would
  otherwise slip through preflight on its integrity match alone.
- Retry transient failures in the preflight probe as well as the readback:
  a rate limit (`E429`) or registry hiccup while probing no longer aborts
  the publish before anything was uploaded. Both shared readers honour a
  `Retry-After` hint from the error body when present (seconds, capped at
  60s per attempt). The publish step enforces a 7-minute overall deadline
  (capped from twice the configured retry window) so it and the separate
  7-minute verify step both fit in the 15-minute job timeout; the verifier
  uses its own 7-minute budget anchored to its start. Each retry is logged
  with the registry and error code (no credentials).
- When `VERIFY_RETRY_DELAY_MS=0` (tests, ad-hoc local runs), `Retry-After`
  hints are ignored entirely and the bound is by attempt count alone.
- Malformed or unparseable errors on non-zero exits now fail fast instead of
  being retried; only exit 0 with empty stdout is treated as transient
  propagation lag.

## [1.5.0] - 2026-10-29

- Raise the seroval override floor from `^1.6.9` to `~1.6.11` (resolving
  1.6.12): GHSA-f86p-h4j2-7qgj/GHSA-9wx9-5pv9-3349 were later extended to
  cover `1.5.5–1.6.10`, so the previous floor resolved inside the affected
  range and the required `Dependency audit` check failed. A lockfile-only
  bump would not move the tree past the override, so package.json and the
  lockfile change together; the consumer override guidance in `plugin/README.md`
  and `CONTRIBUTING.md` follows the new floor. Verified with `npm ci`, `npm audit`
  (0 vulnerabilities) and the TUI check.
- Bound the tunnel name in the collapsed summary to 20 columns (elided with
  `…`) so a long hostname cannot push the reachability state out of the
  header, and replace the nested ternary the reachability state was built
  with (SonarQube typescript:S3358) with plain branches — both raised on
  the collapsed-summary change.
- Restyle the Tunnel sidebar rows to match the sibling TUI plugins: row
  titles are now bold in the theme's base colour, prefixed by two spaces and
  no longer suffixed with a colon; the tunnel heading keeps `text.base`.
  The relative "Checked" age is pinned explicitly to the theme's muted
  colour. `captureSpans()` assertions now guard the scheme end to end: bold
  base titles, muted values elsewhere, and API/State values resolved from
  the theme's `feedback.success`/`feedback.warning`/`feedback.error` palette
  — reachable/connected green, rotating amber, unavailable/disconnected red
  — with the no-feedback-theme fallbacks pinned alongside.
- Name the tunnel in the sidebar's collapsed summary: while collapsed the
  header now reads `▶ Tunnel (<server> · reachable)` — using the configured
  server name from the last status response, and falling back to the bare
  `(reachable)`/`(unavailable)`/`(checking…)` state when no name is known.
- Raise the CI readback bound to 11 attempts × 10s — ten retry intervals,
  ~100s between the first and last read (`VERIFY_ATTEMPTS`,
  `VERIFY_RETRY_DELAY_MS` on the `Publish plugin` verify step). The first
  real npm publish of 1.4.3 showed registry metadata can lag longer than the
  helper's 15s default: uploads succeeded while readback lost the race.

## [1.4.3] - 2026-10-21

- Publish the plugin to the public npm registry (`https://registry.npmjs.org`)
  in addition to GitHub Packages. `Publish plugin` uploads the same tested
  tarball to both registries and reads both back — retrying transient readback
  failures for a bounded period, since a fresh version can lag on a registry's
  read path; npm authenticates with OIDC
  trusted publishing (`id-token: write`, no stored npm token) and the npm
  publish carries signed provenance. The readback verifies the
  `dist.attestations` entry on every npm release, so an unattested npm publish
  fails the workflow. The workflow splits in two: dependency, test and packaging
  steps run in a job without OIDC credentials, and a separate job — the only one
  granted `id-token: write`, running no dependencies — receives the verified
  archive and publishes it, so only the publish job's code can mint an npm
  token. The publish/readback helpers now pass an
  `--@timlaing:registry` override alongside `--registry`, because npm resolves
  an `@timlaing:registry` scope mapping ahead of the plain `--registry` flag
  and would otherwise silently redirect scoped publishes to GitHub Packages.
  The publish helper probes every registry before uploading to any — archive
  integrity and repository metadata are validated in that preflight: published
  versions are immutable, so a divergence between registries can only be
  repaired by a version bump and must be detected before anything lands.
- Treat npm's exit-0-with-empty-output responses — a missing version during
  the publish preflight, metadata still propagating during readback — as
  missing/transient cases instead of crashing in `JSON.parse`, with tests
  pinning both paths.

## [1.4.2] - 2026-10-18

- Close the coverage gap behind the SonarQube quality gate. The Tunnel sidebar
  was verified only by a standalone script that ran outside the suite emitting
  `lcov.info`, so all of `plugin/src/tui.ts` read as uncovered. Add a node:test
  suite covering the render paths — reachable rows, rotating/disconnected state
  colours, stale rows after an API failure, the pre-first-response placeholder,
  a null server, and the missing-options toast.
- Run the test scripts with `--conditions=browser`. Without it `solid-js`
  resolves to the non-reactive server build, so signal updates never re-render.
- Move `verify-tui.ts` from `plugin/scripts/` to `plugin/test/` so it is
  classified as test code and stops counting as production source needing
  coverage.
- Run CI on Node 26 so the sidebar test can render: `@opentui/core`'s Node
  backend needs the `node:ffi` builtin, which Node 24 LTS lacks. There is no
  software fallback renderer.

No behaviour change — the published runtime (`index.ts`, `tui.ts`, `src/**`) is
byte-identical to 1.4.1.

## [1.4.1] - 2026-10-17

- Refactor the Tunnel sidebar render path to clear the SonarQube findings on
  `plugin/src/tui.ts`: hoist the row builder out of the render closure (max
  nesting is now 5 levels), replace the two nested ternaries with
  `collapsedSummary()`/`stateColour()` helpers, and make `/tunnel-toggle`'s
  handler synchronous. No behaviour change.

## [1.4.0] - 2026-10-17

- Restyle the Tunnel sidebar after the MCP box: values right-aligned,
  collapsible header (click or `/tunnel-toggle`) with ▶/▼ arrow and a muted
  summary when collapsed. Fix span colours — inline runs need
  `style={{ fg }}` (a bare `fg` prop on `<span>` is silently dropped) — and
  use the theme's `text.feedback.*` colours for API/State coding.

## [1.3.0] - 2026-10-16

- Polish the Tunnel sidebar: bold heading; white labels with grey values;
  colour-coded API and State values; `Started` as `HH:MM:SS DD/MM/YY`;
  `Checked` as a live relative age ("25s ago"); drop the connection ID row.

## [1.2.1] - 2026-10-16

- Degrade the TUI sidebar to one actionable toast when plugin options are
  missing instead of failing setup with a raw schema error. OpenCode's TUI
  runtime does not receive options from `opencode.json(c)`; they must also be
  declared in `cli.json`.
- Load the sidebar's OpenTUI/Solid runtimes from the host's
  `opentui:runtime-module:` ids instead of the plugin's own installed copies.
  OpenCode v2.0.25 resolves a plugin's `@opentui/solid` imports to a second
  renderer instance whose context is never provided, which crashed every slot
  render with `No renderer found`. Fall back to the local packages (test
  harness) and, if rendering still fails, to one explanatory toast.
- Run the dependency audit workflow on every pull request so its required
  status check registers even when the plugin manifest and lockfile are
  unchanged.
- Fail publishing tools fast with a clear error naming the stdin interface
  when invoked the old way with a manifest path argument or an interactive
  terminal, and run npm's CLI under Node (via `npm_node_execpath`) instead of
  whichever runtime executes the script.

## [1.2.0] - 2026-10-15

- Add a live Tunnel section to the OpenCode sidebar with connection details,
  API availability, stale-data handling and `/tunnel-refresh`.
- Override the Solid serializer dependency to patched Seroval `^1.6.9` and
  document the root-install override requirement.
- Simplify retry-delay parsing without changing Retry-After handling.
- Disable dependency lifecycle scripts in CI and publishing installs. Read pack
  metadata from stdin and invoke npm through its parent-provided absolute CLI path.

## [1.1.0] - 2026-10-15

- Configure plugin publishing for public GitHub Packages and verify repository
  and package visibility before publication.
- Update installation, security reporting, contribution and Sonar documentation
  for the public repository; retain GitHub npm authentication instructions.
- Remove the Python server, its tests, deployment files and bundled releases.
- Keep plugin CI, package publication and coverage; install the server separately
  from the `ssh-tunnel-switch` PyPI package.

Earlier entries below describe the repository before the server was extracted.

## [1.0.0] - 2026-10-15

- Remember the last successful SSH server across restarts in an atomic state file,
  defaulting to ~/.config/opencode-tunnel-switch/state.json.
- Discover CLI configuration in ~/.config/opencode-tunnel-switch/config.yaml, falling back to ./config.yaml.
- Add YAML state_file/server_name options and CLI --state-file/--server-name overrides.
- Fix HTTPS CONNECT streams closing at the idle timeout despite ongoing response
  or upload traffic; measure inactivity across both directions of the tunnel.

- Include the plugin lockfile in release bundles and install locked production
  dependencies with npm ci; validate that installation in release CI.
- Disable shared Node/Bun caches in the release packaging workflow.

- Verification commands, CI coverage and demonstrated runtime evidence centralized
  in CONTRIBUTING.md; compatibility guide retains runtime requirements.

- Detailed service/plugin configuration and API reference moved to docs/configuration.md;
  README retains a minimal local setup example.

- Release-bundle installation, with development instructions in CONTRIBUTING.md.
- GitHub release asset packaging and fresh-wheel installation verification.

- Real OpenSSH integration tests with disposable Docker servers: forwarding,
  rotation, strict host-key rejection, server loss, recovery and cleanup; enabled
  in Linux CI and available locally by explicit opt-in.

- MIT license in the repository and both distribution formats.
- Automatic issue/PR labels, stale handling and contribution guidance.
- Main-branch ruleset prepared; enforcement is blocked by the private repository's
  current GitHub plan.
- Deployment, security, compatibility and troubleshooting guides, with a Linux
  systemd unit and syntax verification.

## [0.1.1] - 2026-10-14

- Published privately to GitHub Packages as `@timlaing/opencode-tunnel-switch`.
- Added registry readback verification of version, archive integrity and repository
  link, replacing an unreliable private-package listing API check.
- Documented private registry authentication and OpenCode installation.

## [0.1.0] - 2026-10-14

- OpenCode v2 rate-limit detection, serialized REST rotation and `/tunnel-status`.
- SSH server lists, host-only aliases inheriting the service account's SSH config,
  SOCKS readiness checks, connection identity and UTC start time.
- Required YAML validation, token generation/persistence and CLI help on failures.
- Built-in HTTP forwarding and HTTPS CONNECT through SOCKS with remote DNS.
- Proxy discovery and process-wide OpenCode proxy environment management.
- CI, dependency audits, issue/PR templates and private package publication.

Publication history: plugin 0.1.0 uploaded successfully, although its workflow's
subsequent package-listing verification failed. Plugin 0.1.1 completed publication
and verification successfully. Python 0.1.0 builds from source; no PyPI publication
workflow is configured.
