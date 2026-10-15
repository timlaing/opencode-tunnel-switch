# Troubleshooting

For server configuration, SSH, proxy or deployment failures, use [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch). Start that server before loading the plugin. Keep API tokens and private configuration out of reports.

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
