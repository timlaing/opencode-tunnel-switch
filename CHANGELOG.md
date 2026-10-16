# Changelog

This repository releases the OpenCode plugin. The Python server is now maintained
separately in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch).

## Unreleased

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
