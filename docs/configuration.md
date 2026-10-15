# Configuration and operation

This guide describes the Python service YAML, OpenCode plugin options, proxy
discovery, rotation behavior and REST API. Start with the
[release installation steps](../README.md#install-and-run), then adapt the
[complete YAML example](../examples/config.yaml) and
[OpenCode example](../examples/opencode.jsonc) to your deployment.

## Python service configuration

Edit `config.yaml` with your SSH host aliases and the SOCKS, HTTP proxy and API bind IP/port. Only `host` is required for each SSH server. `name` defaults to `host`; `user`, `port` and `identity_file` are optional overrides. When omitted (or null), the SSH command leaves them unset, so the system SSH client inherits settings from `~/.ssh/config` for the account running the service. Without configured SSH values, OpenSSH uses its own defaults. Identity paths relative to the YAML file resolve from its directory; `~` expands. YAML is mandatory for every CLI command. Unknown fields, invalid IPs/ports, duplicate server names and missing identity files are rejected.

| YAML field | Default | Purpose |
| --- | --- | --- |
| `servers` | Required nonempty list | SSH aliases and optional per-server overrides |
| `proxy` | Required section | SSH SOCKS listener; `ip` defaults to `127.0.0.1`, `port` to `1080` |
| `http_proxy` | Enabled at `127.0.0.1:8118` | HTTP forwarding and HTTPS CONNECT listener; see the proxy section below |
| `api` | `127.0.0.1:8765` | REST bind address and optional `token`; missing tokens are generated on startup |
| `cooldown_seconds` | `30` | Minimum time after a completed or failed rotation before the next attempt; zero disables cooldown |
| `startup_timeout_seconds` | `15` | SSH connection/readiness deadline, greater than zero and at most 120 seconds |
| `stop_timeout_seconds` | `5` | Wait before forcibly killing an SSH process, greater than zero and at most 60 seconds |
| `start_on_launch` | `true` | Start the saved SSH server (or the first server without saved state) when the API starts |
| `state_file` | `~/.config/opencode-tunnel-switch/state.json` | Last successfully connected server; `null` disables persistence |
| `server_name` | `null` | Optional starting server name, overriding saved state |

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

Copy the displayed token into the plugin's `apiToken` option in `opencode.json`. No token environment variable is used. `status` and `rotate` read the saved YAML token; they do not generate one. `serve` resumes the saved SSH server unless `start_on_launch: false`; without saved state it starts the first server. Ctrl-C cleans up its SSH process. Each command supports `--help`; command/configuration/network failures print an error and CLI help with a nonzero exit code.

Run exactly one service process for a given SOCKS socket. The supplied CLI uses one Uvicorn worker, without reload. It manages only SSH processes it spawned. An existing process occupying the SOCKS address is rejected rather than terminated. The cooldown also applies after startup and failed rotations, so an immediate rotation within the default 30 seconds returns 429.

## Restart state and startup selection

The service saves the last successfully connected server to
`~/.config/opencode-tunnel-switch/state.json` by default, using the home of the
account running it. On restart it reconnects to that server, then subsequent
rotations advance through the configured list. Servers are identified by name
and host rather than list position, so reordering the YAML does not lose the
selection. Each new SSH session still has a fresh connection ID and start time.

Configure a different file in YAML or override it for a single run:

```yaml
state_file: ~/.config/opencode-tunnel-switch/state.json
server_name: null
```

```sh
.venv/bin/tunnel-switch serve --config config.yaml --state-file /path/to/state.json
.venv/bin/tunnel-switch serve --config config.yaml --server-name two
```

`--server-name` selects a server by its configured `name`. It takes precedence
over YAML `server_name` and saved state for the first connection, including the
first manual rotation when `start_on_launch` is false. A successful connection
updates the file even when selected explicitly. Later rotations advance normally.
Unknown server names are rejected. YAML state paths are relative to the YAML
file; relative CLI state paths use the current working directory. `~` expands
for the service account. Use a separate state file for each service instance.

Missing files, or saved servers removed/renamed in YAML, start at the first server.
Malformed, unsupported-version or unreadable state files cause startup to fail
with an error; move the file aside or explicitly select `--server-name` to
replace invalid contents on the next successful connection. Set `state_file: null`
in YAML to opt out. `--state-file` overrides that opt-out.

State is written only after SSH readiness succeeds, using atomic replacement and
mode 0600. Parent directories are created as needed; the service account needs
write access there. Failed SSH attempts leave the previous saved selection intact.
A persistence failure fails that rotation and closes its new SSH process rather
than reporting an unremembered success. Shutdown preserves the file. It contains
only a format version, server name and host, with no API token or private key.
The state path must differ from the YAML and explicitly configured identity files.

## OpenCode configuration

Merge the bundle's `examples/opencode.jsonc` into your OpenCode configuration, replacing the plugin package path with the extracted bundle's absolute `plugin` directory. The REST target is explicitly configurable:

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

