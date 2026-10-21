# OpenCode v2 Tunnel Switch

[![CI](https://github.com/timlaing/opencode-tunnel-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/timlaing/opencode-tunnel-switch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/timlaing/opencode-tunnel-switch)](https://github.com/timlaing/opencode-tunnel-switch/releases)
[![License](https://img.shields.io/github/license/timlaing/opencode-tunnel-switch)](LICENSE)

[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=coverage)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)

[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=bugs)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=timlaing_opencode-tunnel-switch&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=timlaing_opencode-tunnel-switch)

An OpenCode v2 plugin that detects server error message, rotates an HTTP proxy via an external REST server, and retries the current model request. It discovers the server's HTTP proxy and configures proxy environment variables for the OpenCode server process. The OpenCode sidebar displays live tunnel information; `/tunnel-refresh` refreshes it immediately, and `/tunnel-status` displays the connection without a model request.

## Install and run

The Python server now lives in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch) and is available on [PyPI](https://pypi.org/project/ssh-tunnel-switch/):

```sh
python3 -m pip install ssh-tunnel-switch
```

Follow the server repository's instructions to configure SSH servers and start the service. This repository contains only the OpenCode plugin; server configuration, deployment, tests and Python releases are maintained there.

Install the plugin using the [public GitHub Packages guide](plugin/README.md), then add it to your OpenCode configuration:

```json
{
  "plugin": [
    [
      "@timlaing/opencode-tunnel-switch@1.4.3",
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
