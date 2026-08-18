# Standards GitHub Action

Defines how Standards reviews pull requests on GitHub.

## Purpose

The GitHub Action is the automation surface of Standards. It runs
`standards review` for a pull request and reports the result where reviewers
already look: a check run that gates merging, annotations on the changed
lines, and one summary comment on the pull request.

This document specifies the action's workflow integration, authentication,
inputs, run behavior, and reporting surfaces.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the GitHub surface only. The review pipeline, model
selection, and the report content are defined in
[Standards review](./review.md). Credentials are defined in
[Standards provider credentials](./credentials.md). The check run summary
and the summary comment render the same report data as a terminal run; this
document defines only where that data appears on GitHub.

## Workflow integration

The action runs on `pull_request` events. Any other event MUST fail the run
with a diagnostic that names the supported event. A minimal workflow is:

```yaml
name: standards

on:
  pull_request:

permissions:
  contents: read
  checks: write
  pull-requests: write

concurrency:
  group: standards-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: nlecoy/standards@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

The action needs these token permissions and no others:

| Permission | Used for |
| --- | --- |
| `contents: read` | Reading the repository checkout. |
| `checks: write` | Creating and completing the check run. |
| `pull-requests: write` | Creating and updating the summary comment. |

The review compares the pull request's head commit against the merge base of
the head commit and the base branch. The checkout MUST contain the head
revision and the merge base; the example uses `fetch-depth: 0` for this
reason. The action MUST fail with a diagnostic when the merge base is not in
the checkout.

## Authentication

The action authenticates to GitHub with the token given in the
`github-token` input. The default is the workflow's `GITHUB_TOKEN`.

A GitHub App is not required. Every version 1 surface — the check run, its
annotations, and the summary comment — works with the workflow token and the
permissions above. A GitHub App becomes necessary only for behavior this
version excludes: pull request reviews that must be found and dismissed
later, a branded bot identity, and actions outside the triggering
repository.

A repository that wants an app identity anyway MAY mint an installation
token in the workflow and pass it as `github-token`. The action treats every
token the same.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `github-token` | No | GitHub token for the check run and the summary comment. Defaults to the workflow's `GITHUB_TOKEN`. |
| `anthropic-api-key` | No | API key forwarded to the review as `ANTHROPIC_API_KEY`. |
| `openai-api-key` | No | API key forwarded to the review as `OPENAI_API_KEY`. |
| `google-api-key` | No | API key forwarded to the review as `GEMINI_API_KEY`. |
| `model` | No | Model reference forwarded as `STANDARDS_MODEL`. |
| `evaluation-model` | No | Model reference forwarded as `STANDARDS_EVALUATION_MODEL`. |
| `verification-model` | No | Model reference forwarded as `STANDARDS_VERIFICATION_MODEL`. |

The action is a thin surface: each input maps to one environment variable of
`standards review`, and selection precedence stays as defined in
[Standards review](./review.md). The action MUST NOT add its own precedence
rules. An unknown input is rejected by GitHub Actions itself.

Provider API keys MUST be passed from repository or organization secrets.
At least one provider input must resolve a usable credential;
[Run behavior](#run-behavior) defines what happens when none does.

## Run behavior

One run reviews one pull request head:

1. Create a check run named `Standards` for the head commit, in progress.
2. Resolve the configuration, the lock file, and the selected models, and
   run the review pipeline defined in [Standards review](./review.md).
3. Complete the check run with the conclusion, the report as its summary,
   and one annotation per confirmed finding.
4. Create or update the summary comment.
5. Exit with the status that matches the conclusion.

| Review outcome | Check run conclusion | Exit status |
| --- | --- | --- |
| Compliant | `success` | `0` |
| Non-compliant | `failure` | `1` |
| Skipped fork run without credentials | `neutral` | `0` |
| Invalid configuration, resolution failure, or execution failure | `failure` | `2` |
| Cancelled run | `cancelled` | none |

The exit statuses follow the checking command convention defined in
[Standards CLI](./cli.md): `1` is a negative result, `2` is a run that could
not complete. Both fail the workflow job, so merging is gated either way
without extra branch protection configuration. A failure conclusion MUST
carry the diagnostic or the report in the check run summary; a red check
with an empty summary is not actionable.

A re-run for the same head commit creates a new check run and updates the
same summary comment. A run cancelled by the workflow, for example by the
`concurrency` group when a new commit arrives, MUST complete its check run
as `cancelled` when it can still reach the API.

### Annotations

The action MUST create one annotation per confirmed finding, on the
finding's `path` and `lines`. The annotation level follows the rule level:

| Rule level | Annotation level |
| --- | --- |
| `MUST`, `MUST NOT` | `failure` |
| `SHOULD`, `SHOULD NOT` | `warning` |

The annotation text contains the rule `id`, the `reason`, and the rule's
`guidance` when present. The GitHub API accepts at most fifty annotations
per request; the action MUST batch requests so that every finding is
annotated, and MUST NOT silently drop findings beyond a batch.

A suppressed finding MUST NOT produce an annotation. It stays visible in the
check run summary and the summary comment through the report, as defined in
[Standards suppressions](./suppressions.md).

### Summary comment

The summary comment is one pull request comment that carries the report. The
action finds it by a hidden marker that MUST be the comment's first line:

```text
<!-- standards:report:v1 -->
```

- When a comment with the marker exists, the action MUST update it in place.
- When none exists and the review produced findings, or failed, the action
  MUST create it.
- When none exists and the review is compliant without findings, the action
  MUST NOT create one. A clean run adds no noise; the check run already
  reports success.
- The action MUST NOT create a second comment with the marker.

## Fork pull requests

GitHub withholds repository secrets from `pull_request` runs for pull
requests from forks, so provider API keys are absent and the review cannot
run. In that case the action MUST complete the check run as `neutral` with a
summary that explains why the review was skipped, and exit with status `0`.
A fork contributor cannot fix a missing secret, so their pull request MUST
NOT turn red for it.

When no provider input resolves a usable credential and the pull request is
not from a fork, the run is a setup error: the action MUST fail with a
diagnostic that names the missing inputs.

The action MUST NOT be used with the `pull_request_target` event. That event
hands repository secrets to a run whose review reads `.standards.yml`, the
lock file, and the rules from the fork's head revision, and the change
content itself is untrusted input to the agents. Reviews of fork pull
requests wait for the trust policy excluded by
[Standards configuration format](./configuration.md).

## Security considerations

- The workflow token needs only the three permissions listed above. The
  action never needs `contents: write`.
- Provider API keys are secrets. Logs, the check run summary, and the
  summary comment MUST NOT contain them, as required by
  [Standards provider credentials](./credentials.md).
- The action MUST NOT restore the source cache from a CI cache service, as
  required by [Standards source cache](./cache.md). Each run starts with an
  empty cache on an ephemeral runner.
- Change content is untrusted input to the review agents;
  [Standards review](./review.md) defines those rules. The summary comment
  renders finding evidence, which quotes the change; the quote length limits
  in that document bound what a manipulated change can display.

## Version 1 exclusions

This version does not define:

- Pull request reviews (`APPROVE`, `REQUEST_CHANGES`), inline review
  comments, or review dismissal. The check run and its annotations carry
  the findings.
- A hosted GitHub App or a recommended app configuration.
- Reviews of fork pull requests with repository secrets.
- `push`, `merge_group`, or `workflow_dispatch` events.
- Comment commands, such as re-running or suppressing a finding from the
  pull request thread.
- Reactions to, or deduplication against, comments from humans or other
  bots.
- Action outputs for downstream workflow steps.
