# Changelog

The Python service and OpenCode plugin have independent versions. GitHub release
tags and npm publication describe the plugin unless explicitly stated otherwise.

## Unreleased

- Verification commands, CI coverage and demonstrated runtime evidence centralized
  in CONTRIBUTING.md; compatibility guide retains runtime requirements.

- Detailed service/plugin configuration and API reference moved to docs/configuration.md;
  README retains a minimal local setup example.

- Release-bundle installation, with development instructions in CONTRIBUTING.md.
- GitHub release asset packaging and fresh-wheel installation verification.

- Real OpenSSH integration tests with disposable Docker servers: forwarding,
  rotation, strict host-key rejection, server loss, recovery and cleanup; enabled
  in Linux CI and available locally by explicit opt-in.

- MIT license in the repository and both distribution formats; plugin 0.1.2 is
  prepared but not yet published.
- Automatic issue/PR labels, stale handling and contribution guidance.
- Main-branch ruleset prepared; enforcement is blocked by the private repository's
  current GitHub plan.
- Deployment, security, compatibility and troubleshooting guides, with a Linux
  systemd unit and syntax verification.

## Plugin 0.1.1 — 2026-10-14

- Published privately to GitHub Packages as `@timlaing/opencode-tunnel-switch`.
- Added registry readback verification of version, archive integrity and repository
  link, replacing an unreliable private-package listing API check.
- Documented private registry authentication and OpenCode installation.

## Plugin 0.1.0 / Python service 0.1.0 — 2026-10-14

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
