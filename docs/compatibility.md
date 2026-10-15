# Compatibility

| Component | Requirement |
| --- | --- |
| Python service | Python 3.12 or newer and the system OpenSSH client |
| Plugin dependencies | Node/npm; CI uses Node.js 24 |
| OpenCode | v2 plugin API; SDK dependency pinned to `@opencode/plugin` 2.0.29 |
| Proxy runtime | Bun; CI pins 1.4.3 |
| Background service example | Linux with systemd; macOS supports the foreground CLI |
| Windows | No Windows support verification or native service example |

See [Verification in CONTRIBUTING.md](../CONTRIBUTING.md#verification) for test
commands, the demonstrated runtime matrix, CI evidence and verification limits.

OpenCode v1 configuration and plugin APIs are unsupported. v2 uses singular
`plugin` and `[package, options]` entries. HTTP/1.1 forwarding and HTTPS CONNECT
are tested; native WebSocket proxy behavior and HTTP Upgrade are not guaranteed.

Plugin and Python versions are independent. The 1.0.0 release versions both
components as 1.0.0. See the [changelog](../CHANGELOG.md) and package registry before
selecting an installation version.
