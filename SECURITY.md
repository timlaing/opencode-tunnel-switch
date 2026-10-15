# Security policy

## Reporting a vulnerability

This repository and its issues are public. Do not put vulnerability details,
credentials, private keys, personal data or sensitive deployment information in
public issues, pull requests or discussions.

Use GitHub's **Report a vulnerability** option on the repository's Security tab
when it is available. If private reporting is unavailable, contact the maintainer
through an existing private channel and agree on a private method before sending
sensitive reproduction material. Do not use a public issue as a substitute.

No response-time guarantee or older-release support commitment is offered.
Security fixes target the current development branch and the latest releases;
upgrade both components when a fix affects their interaction.

## Plugin boundaries

The plugin stores a server bearer token in OpenCode configuration. Keep it private and use TLS for remote REST access. It changes proxy variables for the whole OpenCode process, affecting all sessions and environment-aware providers. Existing bypass entries can allow direct connections. Tunnel rotation does not guarantee provider quota recovery.

Server token management, SSH keys, proxy listener access and service deployment are maintained in [ssh-tunnel-switch](https://github.com/timlaing/ssh-tunnel-switch). Report server vulnerabilities using that project's security policy.

Dependency audits and updates complement review; passing audits are not a claim that the code has no vulnerabilities.
