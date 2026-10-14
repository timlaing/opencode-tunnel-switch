# Security policy

## Reporting a vulnerability

This repository is private. Authorized collaborators should open a sanitized
issue with the `security` and `keep-open` labels and alert the maintainer through
their existing private contact channel. Issues are visible to repository
collaborators, so do not include credentials, private keys, personal data or
sensitive deployment details. Agree on a private method before sending sensitive
reproduction material. Do not post vulnerability details to a public issue in
another repository.

GitHub's security advisories and private vulnerability reporting are currently
[available for public repositories](https://docs.github.com/en/code-security/concepts/vulnerability-reporting-and-management/repository-security-advisories);
this private repository does not advertise an unavailable reporting endpoint.
No response-time guarantee or older-release support commitment is offered.
Security fixes target the current development branch and the latest releases;
upgrade both components when a fix affects their interaction.

## Deployment boundaries

- The bearer token protects REST status and rotation endpoints. HTTP and SOCKS
  proxy listeners have no authentication. Use loopback or firewall access limited
  to intended clients; do not expose an unrestricted proxy to the Internet.
- Use TLS in front of a remotely accessed REST API. HTTPS CONNECT transports
  destination TLS unchanged; the service does not decrypt it.
- The YAML and OpenCode configuration contain the REST token. Keep both private.
  The CLI deliberately prints the token at every startup, including to systemd
  journal logs. Restrict log access and redact diagnostics before sharing.
- Protect the dedicated SSH key and verify host keys. The service uses batch
  authentication and strict host-key checking. It runs as one account and reads
  that account's SSH configuration. Configuration-write access can change hosts
  and exposed listeners, so grant it only to trusted administrators.
- Token rotation: stop the service, replace `api.token` with a fresh secret (or
  set it to null to generate one on the next startup), start the service, update
  every plugin's `apiToken`, and reload those plugins. Existing tokens are loaded
  at startup; editing the file alone does not revoke the running token.
- Run one API worker and one service instance per SOCKS socket. Coordination is
  within one process, not across multiple instances.
- The plugin changes proxy variables for the whole OpenCode process. All sessions
  and environment-aware providers can route through the selected SSH server.
  Existing connections may survive until rotation; bypass hosts route directly.
- Forwarding fails when SOCKS is unavailable. Tunnel rotation does not establish
  that a provider quota was reset and does not replace provider account controls.

Dependency audits and updates complement review; passing audits are not a claim
that the code has no vulnerabilities. See the [deployment guide](docs/deployment.md)
for service-account and filesystem settings.
