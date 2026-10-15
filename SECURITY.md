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

## Plugin boundaries

The plugin stores a server bearer token in OpenCode configuration. Keep it private and use TLS for remote REST access. It changes proxy variables for the whole OpenCode process, affecting all sessions and environment-aware providers. Existing bypass entries can allow direct connections. Tunnel rotation does not guarantee provider quota recovery.

Server token management, SSH keys, proxy listener access and service deployment are maintained in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch). Report server vulnerabilities using that project's security policy.

Dependency audits and updates complement review; passing audits are not a claim that the code has no vulnerabilities.
