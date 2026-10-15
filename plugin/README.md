# @timlaing/opencode-tunnel-switch

OpenCode v2 plugin that discovers the Python service's HTTP proxy, configures proxy environment variables for the OpenCode server process, and rotates an SSH SOCKS tunnel when a configured provider reports exhausted free usage. `/tunnel-status` displays the current connection ID and start time without a model request.

The external [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch) server, available on [PyPI](https://pypi.org/project/ssh-tunnel-switch/), must be running before plugin startup. See the repository [setup guide](https://github.com/timlaing/opencode-tunnel-switch#readme).

After a successful tunnel switch, the plugin requests that OpenCode retry the current model request after one second, continuing the existing work automatically. Status display runs independently so a slow or failed notification cannot delay continuation. If a switch returns 429 (for example, another switch is already in progress), only the current work request is retried after `Retry-After`; the switch is not retried in that retry sequence. A local cooldown similarly delays the work request until it expires. Other switch failures stop the retry, and OpenCode's retry limit still applies.

The OpenCode session sidebar also includes a **Tunnel** section with connection
state, server, ID, start time, uptime, proxy address and API availability. It
refreshes every five seconds; `/tunnel-refresh` refreshes immediately. Failed
checks mark previous details stale. Reload OpenCode after updating the plugin.
The TUI uses the same API options from the terminal machine, so remote-server
setups need an API address reachable from that machine.

## Install from public GitHub Packages

The package is distributed through GitHub Packages. Public npm packages on this registry still require authentication, as documented by [GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages). Use a GitHub personal access token (classic) with `read:packages`:

```sh
npm login --scope=@timlaing --auth-type=legacy --registry=https://npm.pkg.github.com
```

Add this scope mapping to your user `~/.npmrc` if it is not already present:

```ini
@timlaing:registry=https://npm.pkg.github.com
```

Keep registry credentials in your npm user configuration, not the repository. Configure OpenCode using the singular `plugin` key and the `[package, options]` tuple:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@timlaing/opencode-tunnel-switch@1.0.0",
      {
        "apiIp": "127.0.0.1",
        "apiPort": 8765,
        "apiToken": "copy-the-token-displayed-by-the-python-service"
      }
    ]
  ]
}
```

The REST token is separate from GitHub registry credentials. Proxy IP/port are discovered automatically from `/status`. OpenCode's Bun runtime loads the shipped TypeScript root `index.ts`; no consumer build step is required. Local development can still configure the absolute `plugin` directory instead of the package name.

## Serializer dependency

OpenTUI currently requires a Solid version that constrains Seroval to a vulnerable
release range. This checkout overrides Seroval to `^1.6.9` and audits that resolved
tree. npm applies overrides only from the installing root project: applications
installing this package must also enforce a patched Seroval version in their root
dependency configuration. This package's override does not patch OpenCode's own
bundled dependencies.

## Publishing

The repository's `Publish plugin` workflow runs plugin types and tests, checks the package allowlist, installs the packed tarball and verifies its OpenCode entrypoint before publishing that exact archive to `https://npm.pkg.github.com`.

Publishing runs when a GitHub release is published, or manually on `main`. A release tag must be `v<package-version>` or `plugin-v<package-version>`, matching `package.json`. Update the manifest and lockfile version before releasing a new version. Published versions cannot be overwritten.

Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`; no publishing PAT or repository secret is required. The package is linked to the public repository. The manifest requests public access; the workflow checks that both the repository and existing GitHub package are public before publishing. GitHub package visibility is a separate setting: maintainers manage it under [package settings](https://github.com/users/timlaing/packages/npm/opencode-tunnel-switch/settings), rather than relying on npm access flags. The workflow reads the published version back from the npm registry and verifies its archive integrity and repository link. Do not set the npm `private: true` flag, which prohibits publication.
