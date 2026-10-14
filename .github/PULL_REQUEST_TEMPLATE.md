## Change

Describe the problem and the resulting behavior. Link related issues.

## Validation

List the commands/checks run and their results. Relevant checks include:

- `python -m pytest -q` with Bun available for the proxy integration test.
- `npm run check` and `npm test` in `plugin/`.
- `python -m build` and `tunnel-switch validate --config examples/config.yaml` for packaging/configuration changes.
- An actual OpenCode load/status check for entrypoint, hook or command changes.

## Compatibility and configuration

Describe any changed options, migration steps, SSH config interactions or process-wide proxy behavior. Write “None” if there are no changes.

- [ ] Relevant tests and examples/documentation are updated.
- [ ] The change contains no live configuration, credentials, private keys or sensitive diagnostic data.
