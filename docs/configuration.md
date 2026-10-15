# Plugin configuration and operation

The Python server is maintained in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch) and distributed on [PyPI](https://pypi.org/project/ssh-tunnel-switch/). Follow its documentation for server installation, YAML, deployment and API details.

## OpenCode configuration

Merge `examples/opencode.jsonc` into your OpenCode configuration, using the installed package name or your checkout's absolute `plugin` directory. The REST target is explicitly configurable:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "/absolute/path/to/opencode-tunnel-switch/plugin",
      {
        "apiIp": "127.0.0.1",
        "apiPort": 8765,
        "apiToken": "paste-the-token-displayed-by-the-service"
      }
    ]
  ]
}
```

Use the singular `plugin` key and a two-element `[packagePath, options]` array, as defined by the [configuration schema](https://opencode.ai/config.json). The `plugins` key and `{ "package": ..., "options": ... }` format are not accepted by that schema.

| Plugin option | Default | Meaning |
| --- | --- | --- |
| `apiIp` | `127.0.0.1` | REST server IP; IPv4 or IPv6 |
| `apiPort` | `8765` | REST server port, 1–65535 |
| `apiScheme` | `http` | `http` or `https` (TLS requires a reverse proxy) |
| `apiToken` | Required | Shared bearer token copied from YAML/startup console |
| `configureProxy` | `true` | Set proxy variables for the entire OpenCode server process |
| `proxyIp` | Discovered from `/status` | Optional override for the reachable HTTP proxy IP |
| `proxyPort` | Discovered from `/status` | Optional override for the reachable HTTP proxy port |
| `noProxy` | `[]` | Additional hosts/domains to bypass the proxy |
| `providers` | `["opencode"]` | Provider IDs eligible to trigger rotation |
| `patterns` | See [example](../examples/opencode.jsonc) | Case-insensitive regexes against error type/message |
| `timeoutMs` | `25000` | API request deadline; increase if service startup/stop timeouts increase |
| `cooldownMs` | `30000` | Plugin cooldown between attempts, including failed calls |

The default patterns match `FreeUsageLimitError`, `free usage exceeded`, and the reported `rate limit exceeded. please try again later` message. An unrelated 429 does not trigger rotation. If supplied, the error HTTP status must be 402, 403 or 429. OpenCode's retry hook can also provide an error without a status.

Concurrent plugin triggers share the same pending request. A matched failure at the first retry opportunity rotates once and requests a retry after one second; later attempts do not rotate again. OpenCode retains its built-in maximum retry count. API failures leave that matched failure terminal and report the reason to server stderr.

Use **`/tunnel-status`** in OpenCode to display status as a synthetic session message, including connection ID and start time. This command uses no model request, so it remains useful when model usage is exhausted. Successful rotations also add a status message.

## Proxy discovery and process routing

Before changing the environment, the plugin queries the authenticated `/status` endpoint directly and discovers `http_proxy.ip`, `http_proxy.port` and `http_proxy.enabled`. OpenCode only needs the REST address and token; no proxy address/port settings are required. Wildcard bind IPs (`0.0.0.0` or `::`) resolve to the configured REST API IP. An explicit bind IP is used as returned. For remote services the listener must be reachable from OpenCode: a loopback listener stays local to the service machine. Optional `proxyIp`/`proxyPort` overrides support NAT or alternate reachable addresses; these still require successful discovery and an enabled proxy. Wildcard override addresses are rejected.

Discovery happens once at plugin startup. Start the Python service first. If the API is unavailable, its response is invalid, or its HTTP proxy is disabled, plugin startup fails with a clear error before modifying the process environment. Reload the plugin after changing the service HTTP proxy configuration. `configureProxy: false` skips startup discovery and environment configuration while retaining rotation/status features.

After successful discovery, the plugin sets `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and their lowercase counterparts to `http://<proxyIp>:<proxyPort>`. It merges existing bypass entries with localhost, IPv4/IPv6 loopback, the REST API IP, and `noProxy`, setting both `NO_PROXY` and `no_proxy`. No manual proxy environment setup is required. The shared API token remains in YAML and OpenCode plugin configuration, not environment variables.

These changes apply to the entire OpenCode server process, all sessions and providers using environment-aware HTTP clients, and subprocesses started afterward. They take effect for subsequent Bun fetch requests; [Bun's fetch documentation](https://bun.sh/docs/runtime/networking/fetch#proxying-requests) confirms that it reads proxy environment variables on each request. Already-open connections, already-running subprocesses and clients that explicitly override proxies are not reconfigured. Existing bypass entries are retained, including a wildcard `*` if one is present. Native WebSocket proxy behavior is runtime-dependent; this change verifies HTTP requests and HTTPS CONNECT, not native WebSocket transport.

The plugin's own REST calls explicitly use Bun's `proxy: false`, so rotation/status still work while the SSH tunnel is unavailable. Unloading the plugin restores its prior environment without overwriting later external edits. If multiple project instances configure proxies in the same process, the latest loaded instance selects the process-wide proxy; all active instances' REST IPs stay bypassed. Unloading it restores the preceding instance. Use the same settings across projects sharing a server.


## Tunnel sidebar

The plugin includes a TUI entrypoint that adds a **Tunnel** section to OpenCode's
session sidebar. It shows tunnel state, server name, connection ID, start time,
uptime, HTTP proxy address, API availability and the time of the last check.
OpenCode loads the package's `./tui` export automatically alongside the server
plugin; local-directory installations use the root `tui.ts` entrypoint. Keep the
sidebar visible to see the section and reload OpenCode after updating the plugin.

The display reads `/status` at startup and every five seconds after the previous
request finishes. Tunnel switches appear on the next refresh. Use
`/tunnel-refresh` or **Refresh tunnel status** in the command palette for an
immediate refresh. `/tunnel-status` still adds a status message to the session.
These commands make no model request.

When a status request fails or returns invalid data, the display marks the API
unavailable and any previous connection information as stale. Stale uptime is
frozen at the last successful check, while the check time records the latest
attempt. API reachability
does not prove the SSH tunnel can reach a provider. Error response bodies and API
tokens are never displayed. Polling stops when the TUI plugin unloads.

The TUI reads the API from the terminal's machine using the configured API
address and token. When attaching to a remote OpenCode server, that address must
also be reachable from the terminal machine; loopback refers to the local machine.
