# OpenCode v2 Tunnel Switch

An OpenCode v2 plugin that detects provider free-usage limits, rotates an SSH tunnel through an external REST server, and retries the current model request. It discovers the server's HTTP proxy and configures proxy environment variables for the OpenCode server process. `/tunnel-status` displays the connection without a model request.

## Install and run

The Python server now lives in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch) and is available on [PyPI](https://pypi.org/project/ssh-tunnel-switch/):

```sh
python3 -m pip install ssh-tunnel-switch
```

Follow the server repository's instructions to configure SSH servers and start the service. This repository contains only the OpenCode plugin; server configuration, deployment, tests and Python releases are maintained there.

Install the plugin using the [GitHub Packages guide](plugin/README.md), then add it to your OpenCode configuration:

```json
{
  "plugin": [
    [
      "@timlaing/opencode-tunnel-switch@1.0.0",
      {
        "apiIp": "127.0.0.1",
        "apiPort": 8765,
        "apiToken": "copy-the-token-from-your-server"
      }
    ]
  ]
}
```

Start the server before OpenCode, then use `/tunnel-status` to verify access. Keep the API token private. For local source installation, use the checkout's absolute `plugin` directory as the package path and install dependencies with `npm ci --prefix plugin`.

## Guides

- [Plugin configuration and proxy discovery](docs/configuration.md)
- [External server deployment](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Compatibility](docs/compatibility.md)
- [Development, verification and releases](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

Licensed under the [MIT License](LICENSE).
