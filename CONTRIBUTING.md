# Contributing

Use a feature branch and open a pull request into `main`. Keep changes focused,
include relevant validation in the PR template, and keep credentials out of
issues, logs and examples. See the [README](README.md#verification) for checks.

## Labels and triage

Issue forms set `bug` or `enhancement` and `needs-triage`. Automation adds a
component label from the bug form. Maintainers remove `needs-triage` after
review and can adjust labels manually. PRs receive labels from changed paths,
conventional title prefixes (`fix:`, `feat:`, `docs:`, `ci:`, `test:`, `build:`),
and Dependabot authorship. Automatic labels are additive and preserve manual
labels. The label definitions are in [.github/labels.json](.github/labels.json).

## Inactive work

Daily maintenance marks issues stale after 60 inactive days and PRs after 30,
then closes them after 14 further inactive days. New activity removes `stale`.
Draft PRs, items with milestones, and items labeled `keep-open`, `security`, or
`priority: high` are exempt. Stale closure does not indicate a fix. Items can
be reopened, and stale PR branches are retained.

## Main branch protection

The intended ruleset is [.github/rulesets/main.json](.github/rulesets/main.json):
PRs only, one approving review, dismissal of stale approvals, approval after
the latest push by someone other than its author, resolved review threads,
all five CI jobs passing against an up-to-date branch, linear history, no
force pushes or deletion, and no bypass actors. Review requires a second
person; PR authors cannot approve their own changes.

GitHub currently rejects protection for this private repository because its
owner's plan does not support it. The JSON file is a configuration artifact,
not active protection. Once GitHub Pro is available, an administrator can
import it under Settings → Rules → Rulesets, or apply it with:

```sh
gh api --method POST repos/timlaing/opencode-tunnel-switch/rulesets \
  --input .github/rulesets/main.json
```

Squash/rebase merging and automatic deletion of merged branches are enabled
in repository settings. Dependency-audit checks are conditional on changed
paths, so they are not required checks in the ruleset.
