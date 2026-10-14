# OpenCode v2 Tunnel Switch

An OpenCode v2 plugin detects the reported `Error: Rate limit exceeded. Please try again later.` error for the `opencode` provider and calls a Python REST service to rotate an SSH SOCKS5 tunnel. The same Python process exposes an HTTP forward proxy and HTTPS CONNECT bridge through the SSH SOCKS5 listener. The plugin configures proxy environment variables for the whole OpenCode server process at startup. The service stops its current SSH process, advances through the YAML server list in order, waits for a successful SOCKS5 handshake, and returns the new connection ID and UTC start time.

## Guides

- [Configuration and API reference](docs/configuration.md)
- [Deployment and systemd service](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Compatibility and verification](docs/compatibility.md)
- [Development, releases and contribution policy](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Install and run

Requires Python 3.12+, OpenSSH, Node/npm for the plugin's runtime dependencies,
and OpenCode v2. Source development and tests are documented in
[CONTRIBUTING.md](CONTRIBUTING.md#development).

Download the install bundle from a [GitHub release](https://github.com/timlaing/opencode-tunnel-switch/releases).
This repository is private, so authenticate with GitHub CLI using an account with
repository access. Releases must have both assets below before installing.
There are no published GitHub releases yet; the release workflow will provide
these assets when the first release is published.

```sh
gh auth login
gh release download --repo timlaing/opencode-tunnel-switch \
  --pattern opencode-tunnel-switch-release.tar.gz --pattern SHA256SUMS
# Linux:
sha256sum -c SHA256SUMS
# On macOS use: shasum -a 256 -c SHA256SUMS
tar -xzf opencode-tunnel-switch-release.tar.gz
cd opencode-tunnel-switch
python3 -m venv .venv
.venv/bin/python -m pip install service/*.whl
npm install --prefix plugin --omit=dev --ignore-scripts
cp examples/config.yaml config.yaml
chmod 600 config.yaml
```

The bundle includes the Python wheel/sdist, the plugin's production files,
example configuration, documentation, a systemd unit, and `versions.json`.
No source checkout, editable Python install, test dependencies or plugin build
is required. Checksums detect a damaged download; trust the release and its
publisher as well. To select a specific release, put its tag immediately after
`gh release download`.

## Simple configuration

Set your SSH aliases in `config.yaml`. This example uses your existing SSH config
and keeps the SOCKS proxy local:

```yaml
servers:
  - host: ssh-one
  - host: ssh-two
proxy:
  ip: 127.0.0.1
  port: 1080
```

Verify SSH authentication and host keys for both aliases, then start the service:

```sh
.venv/bin/tunnel-switch validate --config config.yaml
.venv/bin/tunnel-switch serve --config config.yaml
```

Startup generates and saves an API token when needed and prints it to the console.
Merge this into `opencode.json`, using the extracted plugin's absolute path and
that token:

```json
{
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

Start OpenCode after the service, then use `/tunnel-status` to check the connection.
The HTTP proxy is discovered automatically. Defaults bind the API and HTTP proxy
to loopback on ports 8765 and 8118. Keep the token and startup output private.

See the [configuration guide](docs/configuration.md) for all YAML/plugin options,
SSH overrides, remote access, proxy behavior and API endpoints. For loading or
connection errors, see [troubleshooting](docs/troubleshooting.md).

## Release and development information

Release bundles are built and checked by `Release install bundle`, then attached
to a published GitHub release. The plugin is also available separately through
private GitHub Packages; see its [package guide](plugin/README.md) for registry
authentication. The bundle installation above needs GitHub repository access and
public npm dependency access, but no GitHub Packages authentication.

Development setup, tests, CI coverage, publishing and repository maintenance
policies are documented in [CONTRIBUTING.md](CONTRIBUTING.md). See the
[compatibility table](docs/compatibility.md) for verified runtimes.

## License

Licensed under the [MIT License](LICENSE).
