# OpenCode v2 Tunnel Switch

An OpenCode v2 plugin detects the reported `Error: Rate limit exceeded. Please try again later.` error for the `opencode` provider and calls a Python REST service to rotate an SSH SOCKS5 tunnel. The same Python process exposes an HTTP forward proxy and HTTPS CONNECT bridge through the SSH SOCKS5 listener. The plugin configures proxy environment variables for the whole OpenCode server process at startup. The service stops its current SSH process, advances through the YAML server list in order, waits for a successful SOCKS5 handshake, and returns the new connection ID and UTC start time.

## Install and run

Requires Python 3.12+, OpenSSH, Node/npm for plugin dependencies, and OpenCode v2. The plugin is checked against `@opencode/plugin` 2.0.29; v1 plugin APIs/configuration are different.

From this directory:

```sh
uv venv --python python3.13
uv pip install --python .venv/bin/python -e '.[test]'
cd plugin
npm ci
cd ..
cp examples/config.yaml config.yaml
```

Edit `config.yaml` with your SSH host aliases and the SOCKS, HTTP proxy and API bind IP/port. Only `host` is required for each SSH server. `name` defaults to `host`; `user`, `port` and `identity_file` are optional overrides. When omitted (or null), the SSH command leaves them unset, so the system SSH client inherits settings from `~/.ssh/config` for the account running the service. Without configured SSH values, OpenSSH uses its own defaults. Identity paths relative to the YAML file resolve from its directory; `~` expands. YAML is mandatory for every CLI command. Unknown fields, invalid IPs/ports, duplicate server names and missing identity files are rejected.

A host-only server list can use existing SSH config aliases:

```yaml
servers:
  - host: ssh-one
  - host: ssh-two
```

Normal `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump` and other SSH config settings apply. An explicit YAML `user`, `port` or `identity_file` is passed as `-l`, `-p` or `-i`. Existing configurations with named servers and explicit values still work. Effective server names must remain unique, including names derived from host aliases.

Authenticate to each SSH server once using your normal SSH client and verify its host key. The service requires key/agent authentication (`BatchMode=yes`) and known hosts (`StrictHostKeyChecking=yes`). It does not prompt for passwords or accept unknown host keys. The SSH accounts must permit TCP forwarding.

The API token lives in `api.token` in the YAML file. On startup, `serve` generates and saves a random token if the field is missing, null or blank. Existing tokens are reused. In both cases it prints `API token: ...` to the console before starting the API. Generated-token writes are atomic, preserve YAML comments, and save the file with mode 0600. If saving fails, startup fails rather than using an unsaved token.

```sh
.venv/bin/tunnel-switch validate --config config.yaml
.venv/bin/tunnel-switch serve --config config.yaml
```

Copy the displayed token into the plugin's `apiToken` option in `opencode.json`. No token environment variable is used. `status` and `rotate` read the saved YAML token; they do not generate one. `serve` starts the first tunnel unless `start_on_launch: false`. Ctrl-C cleans up its SSH process. Each command supports `--help`; command/configuration/network failures print an error and CLI help with a nonzero exit code.

Run exactly one service process for a given SOCKS socket. The supplied CLI uses one Uvicorn worker, without reload. It manages only SSH processes it spawned. An existing process occupying the SOCKS address is rejected rather than terminated. The cooldown also applies after startup and failed rotations, so an immediate rotation within the default 30 seconds returns 429.

## OpenCode configuration

Merge `examples/opencode.jsonc` into your OpenCode configuration, replacing the plugin package path with this checkout's absolute `plugin` directory. The REST target is explicitly configurable:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "/absolute/path/to/Free Switch OC Plugin/plugin",
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
| `patterns` | See example | Case-insensitive regexes against error type/message |
| `timeoutMs` | `25000` | API request deadline; increase if service startup/stop timeouts increase |
| `cooldownMs` | `30000` | Plugin cooldown between attempts, including failed calls |

The default patterns match `FreeUsageLimitError`, `free usage exceeded`, and the reported `rate limit exceeded. please try again later` message. An unrelated 429 does not trigger rotation. If supplied, the error HTTP status must be 402, 403 or 429. OpenCode's retry hook can also provide an error without a status.

Concurrent plugin triggers share the same pending request. A matched failure at the first retry opportunity rotates once and requests a retry after one second; later attempts do not rotate again. OpenCode retains its built-in maximum retry count. API failures leave that matched failure terminal and report the reason to server stderr.

Use **`/tunnel-status`** in OpenCode to display status as a synthetic session message, including connection ID and start time. This command uses no model request, so it remains useful when model usage is exhausted. Successful rotations also add a status message.

## Built-in HTTP proxy and automatic OpenCode routing

The Python service starts an HTTP/1.1 proxy alongside the REST API. It forwards absolute-URL HTTP requests through SOCKS5 and handles HTTPS using CONNECT, preserving end-to-end TLS without decrypting traffic or installing certificates. Destination hostnames are sent to SOCKS5 for remote DNS resolution. Privoxy is no longer required.

```yaml
proxy:                    # SSH's SOCKS listener
  ip: 127.0.0.1
  port: 1080
http_proxy:               # OpenCode connects here
  enabled: true
  ip: 127.0.0.1
  port: 8118
  connect_timeout_seconds: 10
  idle_timeout_seconds: 120
  header_limit_bytes: 65536
  max_connections: 128
api:                      # Rotation/status control plane
  ip: 127.0.0.1
  port: 8765
  token: null
```

All three listeners must use separate sockets. The HTTP proxy defaults to enabled on `127.0.0.1:8118` even when the `http_proxy` section is omitted. Before changing the environment, the plugin queries the authenticated `/status` endpoint directly and discovers `http_proxy.ip`, `http_proxy.port` and `http_proxy.enabled`. OpenCode only needs the REST address and token; no proxy address/port settings are required. Wildcard bind IPs (`0.0.0.0` or `::`) resolve to the configured REST API IP. An explicit bind IP is used as returned. For remote services the listener must be reachable from OpenCode: a loopback listener stays local to the service machine. Optional `proxyIp`/`proxyPort` overrides support NAT or alternate reachable addresses; these still require successful discovery and an enabled proxy. Wildcard override addresses are rejected.

Discovery happens once at plugin startup. Start the Python service first. If the API is unavailable, its response is invalid, or its HTTP proxy is disabled, plugin startup fails with a clear error before modifying the process environment. Reload the plugin after changing the service HTTP proxy configuration. `configureProxy: false` skips startup discovery and environment configuration while retaining rotation/status features.

After successful discovery, the plugin sets `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and their lowercase counterparts to `http://<proxyIp>:<proxyPort>`. It merges existing bypass entries with localhost, IPv4/IPv6 loopback, the REST API IP, and `noProxy`, setting both `NO_PROXY` and `no_proxy`. No manual proxy environment setup is required. The shared API token remains in YAML and OpenCode plugin configuration, not environment variables.

These changes apply to the entire OpenCode server process, all sessions and providers using environment-aware HTTP clients, and subprocesses started afterward. They take effect for subsequent Bun fetch requests; [Bun's fetch documentation](https://bun.sh/docs/runtime/networking/fetch#proxying-requests) confirms that it reads proxy environment variables on each request. Already-open connections, already-running subprocesses and clients that explicitly override proxies are not reconfigured. Existing bypass entries are retained, including a wildcard `*` if one is present. Native WebSocket proxy behavior is runtime-dependent; this change verifies HTTP requests and HTTPS CONNECT, not native WebSocket transport.

The plugin's own REST calls explicitly use Bun's `proxy: false`, so rotation/status still work while the SSH tunnel is unavailable. Unloading the plugin restores its prior environment without overwriting later external edits. If multiple project instances configure proxies in the same process, the latest loaded instance selects the process-wide proxy; all active instances' REST IPs stay bypassed. Unloading it restores the preceding instance. Use the same settings across projects sharing a server.

Set `configureProxy: false` to opt out of environment changes. Set `http_proxy.enabled: false` only if you are managing forwarding elsewhere. The HTTP proxy streams request/response bodies and chunked transfers with bounded buffers. Ordinary HTTP connections close after one response; CONNECT tunnels remain open until EOF, an error or the idle timeout. HTTP Upgrade is unsupported; HTTPS destinations can negotiate their protocols inside CONNECT. Invalid requests return 400, unavailable SOCKS/destination connections return 502, and admission over the connection limit returns 503. It never falls back to a direct destination connection when SOCKS fails.

The HTTP listener stays available during SSH rotation. Existing tunneled connections close when SSH exits, and subsequent connections use the replacement tunnel at the same SOCKS address. Ctrl-C closes both the HTTP proxy and SSH process.

The HTTP and SOCKS listeners are unauthenticated and bind to loopback by default; the bearer token protects only the REST API. For LAN deployment, restrict proxy access to intended clients and use TLS for the REST token. Rotating a tunnel does not guarantee a provider quota reset, particularly for account limits.

## REST API and CLI

All endpoints require `Authorization: Bearer <token>`. FastAPI interactive API docs are available at `/docs`.

| Endpoint | Result |
| --- | --- |
| `GET /status` | State, connection ID, start time, server, SOCKS and HTTP proxy addresses, and last error |
| `POST /rotate` | Stops current tunnel, starts next server, returns status after readiness |

Overlapping rotations and cooldown violations return **429**, with `Retry-After`; callers must trigger again later. They are not queued. Startup/SSH failures return **503** and leave the service disconnected; another trigger after the cooldown advances to the next server. A single-server list restarts the same server. Status remains responsive during rotation and returns `state: "rotating"`; connection ID/start time are null until the new tunnel is ready. After SSH exits, status reports disconnected and clears active connection fields. There is no automatic restart loop.

```sh
.venv/bin/tunnel-switch status --config config.yaml
.venv/bin/tunnel-switch rotate --config config.yaml
curl --noproxy '*' -H "Authorization: Bearer <token-from-YAML>" http://127.0.0.1:8765/status
curl --noproxy '*' -X POST -H "Authorization: Bearer <token-from-YAML>" http://127.0.0.1:8765/rotate
```

Example connected status:

```json
{
  "state": "connected",
  "connection_id": "9d7e9746-c4e2-4a43-8da5-674ab452cb91",
  "started_at": "2026-10-14T12:00:00+00:00",
  "server": "first",
  "proxy": {"ip": "127.0.0.1", "port": 1080},
  "http_proxy": {"enabled": true, "ip": "127.0.0.1", "port": 8118},
  "last_error": null
}
```

## Debug plugin loading

There is no separate build step: OpenCode loads the TypeScript plugin through the root `plugin/index.ts`, which re-exports the implementation in `src/index.ts`. The local-directory loader needs a root `index`/`server` entrypoint; a manifest export pointing only to a nested source file is insufficient. Configure the absolute `plugin` directory using the singular `plugin` key and `[path, options]` tuple above.

Run OpenCode from the same project directory as the affected session:

```sh
opencode reload
opencode plugin list
opencode api GET /api/plugin --param "location[directory]=$PWD"
```

The API response includes plugin states and error details. Look for ID `tunnel-switch`, state `active`, and local source `plugin/index.ts`. Use `/tunnel-status` in the TUI to confirm command registration and REST connectivity. If source changes are not picked up after reload, restart the background service with `opencode service restart`.

For detailed server logs without using the background server, run:

```sh
opencode --standalone --print-logs --log-level debug
```

For the existing server's loader errors on macOS:

```sh
rg 'tunnel-switch|failed to load plugin' ~/.local/share/opencode/log/opencode.log
```

Keep tokens and unrelated credentials out of shared diagnostic output. `npm run check` and `npm test` verify source types/behavior; they do not by themselves prove OpenCode can discover the local package.

## Verification

```sh
.venv/bin/pytest -q
cd plugin
npm run check
npm test
```

Tests cover real HTTP forwarding, streamed/chunked uploads, HTTPS CONNECT with certificate validation, half-closes, proxy failure responses, header validation, connection limits/shutdown, process-wide environment setup/restoration, direct REST calls, configuration/CLI validation, authorization, serialized rotation, cooldown on failures, cancellation, connection identity and status, SOCKS readiness, and plugin endpoint/error matching. Local socket tests need permission to bind loopback ports. SSH process behavior is tested using a local subprocess fixture; real remote SSH credentials and an installed OpenCode runtime are required for deployment verification.

An optional Bun integration test exercises the actual plugin setup, environment routing through the Python bridge, and direct REST calls. It runs when `bun` is on PATH or `TUNNEL_SWITCH_TEST_BUN` points to a Bun executable.

API reference used: [OpenCode v2 plugins](https://opencode.ai/v2/docs/build/plugins/).

## GitHub checks and contributions

CI checks plugin types/tests and runs the Python, HTTP/HTTPS proxy and Bun integration tests on Python 3.12–3.14 on Linux, plus Python 3.13 on macOS. It builds a Python distribution and checks the installed CLI. These checks use local fixtures rather than real SSH credentials or provider accounts.

Dependency audits run when dependency manifests change, weekly and on manual request. Dependabot proposes weekly updates for Python, npm and GitHub Actions dependencies. Issue forms request reproducible, sanitized reports; the PR template records validation and configuration compatibility.
