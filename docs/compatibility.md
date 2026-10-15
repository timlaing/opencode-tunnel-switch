# Compatibility

| Component | Requirement |
| --- | --- |
| External server | [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch), installed separately from PyPI |
| Plugin dependencies | Node/npm; CI uses Node.js 24 |
| OpenCode | v2 plugin API; SDK dependency pinned to `@opencode/plugin` 2.0.29 |
| Proxy runtime | Bun; CI pins 1.4.3 |
| Windows | No Windows support verification or native service example |

See [Verification in CONTRIBUTING.md](../CONTRIBUTING.md#verification) for test
commands, the demonstrated runtime matrix, CI evidence and verification limits.

OpenCode v1 configuration and plugin APIs are unsupported. v2 uses singular
`plugin` and `[package, options]` entries. HTTP/1.1 forwarding and HTTPS CONNECT
are tested; native WebSocket proxy behavior and HTTP Upgrade are not guaranteed.

The plugin and external server are released independently. Server runtime requirements and verification belong to the server repository.
