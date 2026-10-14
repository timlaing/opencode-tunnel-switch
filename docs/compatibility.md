# Compatibility and verification

This table distinguishes demonstrated checks from requirements. It does not
claim every version combination or deployment has been tested.

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

The current package metadata sets Python's minimum version and the SDK pin;
workflow files specify CI runtimes. Inspect the latest successful [CI run](https://github.com/timlaing/opencode-tunnel-switch/actions/workflows/ci.yml)
for evidence against the revision being deployed.

OpenCode v1 configuration and plugin APIs are unsupported. v2 uses singular
`plugin` and `[package, options]` entries. HTTP/1.1 forwarding and HTTPS CONNECT
are tested; native WebSocket proxy behavior and HTTP Upgrade are not guaranteed.

Plugin and Python versions are independent. The Python service remains 0.1.0;
plugin 0.1.1 is published, while 0.1.2 contains MIT licensing changes awaiting
publication. See the [changelog](../CHANGELOG.md) and package registry before
selecting an installation version.
