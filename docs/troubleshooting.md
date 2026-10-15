# Troubleshooting

See the [configuration guide](configuration.md) for YAML fields, plugin options and API behavior.

Check the Python service first, then SSH/proxy connectivity, then plugin loading.
Keep tokens, private addresses, SSH configuration and unrelated credentials out
of reports. The startup console and systemd journal contain the API token.

| Symptom | Check and corrective action |
| --- | --- |
| Configuration validation fails | Run `tunnel-switch validate --config /path/to/config.yaml`; YAML is mandatory, unknown fields are rejected, and configured identity files must exist. Read the printed CLI help. |
| Startup reports an invalid state file | Check the selected `state_file` and service account. Move malformed state aside or use `--server-name` to select a server explicitly. Successful startup replaces the state; see [restart state](configuration.md#restart-state-and-startup-selection). |
| Token cannot be generated/saved | Check ownership and directory permissions. Atomic replacement requires a writable parent directory, not just a writable file. Under systemd use `/etc/tunnel-switch`. |
| REST returns 401 | Compare YAML `api.token` with the plugin's `apiToken` privately; restart/reload after token changes. GitHub package tokens are unrelated. |
| REST returns 429 | Read `Retry-After`; another rotation is underway or the cooldown is active. Wait before requesting again. Startup and failed rotations also initiate cooldown. |
| REST returns 503 or status says disconnected | Check host aliases, authentication, verified known hosts and SSH TCP-forwarding permission as the account running the service. |
| SOCKS address occupied | Stop the duplicate service or select a free socket. The service does not terminate unrelated processes. |
| Streaming response resets around 120 seconds | Earlier proxy versions timed out each CONNECT direction separately, closing active responses when the client was quiet. Upgrade to a version with the shared tunnel inactivity fix. A truly idle tunnel can still close after `http_proxy.idle_timeout_seconds`; SSH loss and rotations also close active connections. |
| HTTP proxy returns 502 | Check the SSH connection and destination reachability; SOCKS failure has no direct fallback. |
| HTTP proxy returns 503 | The connection admission limit is reached. Inspect long-lived connections and configured limits. |
| HTTP proxy returns 400 | Check request framing. Use a normal HTTP proxy client; HTTP Upgrade is unsupported. |
| Plugin fails during startup discovery | Start the API first, confirm authenticated status, enable its HTTP proxy, and check that returned proxy bindings are reachable from OpenCode. |
| Remote discovery returns loopback | Bind the HTTP proxy to a reachable interface or set plugin `proxyIp`/`proxyPort` overrides. Restrict client access. Wildcard bindings are mapped to the REST address. |
| Traffic bypasses the tunnel | Check `NO_PROXY`/`no_proxy`, especially `*`, and clients with explicit proxy settings. Already-open connections are not reconfigured. Do not dump the whole environment into an issue. |
| Tunnel drops while systemd stays active | `active` describes Python, not SSH. Query status and rotate after diagnosing SSH; no automatic tunnel restart loop is implemented. |
| Free usage remains exhausted after rotation | Quotas may belong to the provider account rather than the outgoing address. Rotation does not guarantee quota recovery. |

## Plugin discovery

The config uses singular `plugin`, with a `[packagePath, options]` tuple. Local
installation points to the absolute `plugin` directory, containing root `index.ts`.
Type checks passing does not demonstrate runtime discovery.

Run from the project directory used by the affected session:

```sh
opencode reload
opencode plugin list
opencode api GET /api/plugin --param "location[directory]=$PWD"
```

Look for `tunnel-switch`, state `active`, and any error details. Use `/tunnel-status`
to check command registration and API access. Restart the background service if
reload leaves old code running:

```sh
opencode service restart
```

For private-package authentication, follow the [package guide](../plugin/README.md).
Confirm that the requested version exists in GitHub Packages and that its
publication workflow completed successfully.
During local development avoid running `npm ci` against dependencies used by an
active OpenCode process; it removes `node_modules`. Stop that process or use an
isolated checkout for clean-install verification.

## SSH and diagnostic logs

For systemd use the account-specific checks in the [deployment guide](deployment.md).
In a foreground session, run `ssh -G HOST_ALIAS` to inspect effective settings,
then perform a normal SSH connection to verify authentication and host keys.
A foreground SSH session should use the same account and identity files as the
service. Do not disable strict host-key verification to work around an error.

The service intentionally discards SSH subprocess stderr. Its last error gives
an exit code or readiness timeout; reproduce authentication problems separately
with your SSH client. Diagnostic verbosity may disclose private topology.

For OpenCode macOS server loader errors:

```sh
rg 'tunnel-switch|failed to load plugin' ~/.local/share/opencode/log/opencode.log
```

Or start a foreground OpenCode instance:

```sh
opencode --standalone --print-logs --log-level debug
```

Include the revision, relevant runtime versions, minimal reproduction steps and
redacted errors in a bug report. Omit full config files, whole environment dumps,
startup-token lines and SSH private keys.
