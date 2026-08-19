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
document defines where that data appears on GitHub and how the summary
comment lays it out.

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

### Comment layout

The comment renders the report data in this order. A section with no
entries MUST NOT render:

1. A heading with the conclusion.
2. An alert callout with the merge verdict and the finding counts:
   blocking, warnings, and suppressed.
3. An overview table of the confirmed findings — number, rule `id`,
   `level`, and linked location — when the review confirmed more than one
   finding. With one finding the table repeats the finding and adds noise.
4. Blocking findings: each confirmed `MUST` and `MUST NOT` finding,
   expanded.
5. Warnings: each confirmed `SHOULD` and `SHOULD NOT` finding, collapsed in
   a details block whose summary line shows the rule `id`, `level`, and
   location, with a note that warnings do not block the merge by
   themselves.
6. Suppressed findings as a table: rule `id`, `level`, linked location, and
   the marker's reason, with a note that a suppressed finding was not
   verified. Invalid suppression markers follow as an alert callout with
   each marker's location and problem.
7. A collapsed details block with the counts — resolved rules, selected
   rules, evaluation tasks, findings for each level — and the model,
   invocation count, and token usage of each agent step. It states that
   every reported finding was confirmed by verification.
8. A footer that links the reviewed head commit and the merge base, so an
   updated comment shows which push it describes.

A finding shows its rule `id` and `level`, its `path` and `lines` as a
link, the `evidence` quote in a `diff` code block as an added line, the
`reason`, and the rule's `guidance` and `references` when present, set off
as a quoted fix block. The location MUST link to the file at the head
commit, not to the diff view, so the link stays valid after later pushes.
Blocking findings come first and MUST NOT be collapsed: they are why the
check is red.

A compliant review that produced warnings or suppressed findings uses the
same layout with the compliant conclusion. Example:

````markdown
<!-- standards:report:v1 -->
## 🛑 Standards review — Non-compliant

> [!CAUTION]
> **2 blocking findings** must be resolved or suppressed with a reason
> before this pull request can merge. 1 warning and 1 suppressed finding
> are listed below.

| # | Rule | Level | Location |
| --- | --- | --- | --- |
| 1 | `payments.no-floating-point-money` | 🛑 MUST NOT | [`src/billing/invoice.ts:41-44`](https://github.com/acme/shop/blob/3f2a91c/src/billing/invoice.ts#L41-L44) |
| 2 | `security.no-secrets-in-code` | 🛑 MUST NOT | [`src/config/stripe.ts:8`](https://github.com/acme/shop/blob/3f2a91c/src/config/stripe.ts#L8) |
| 3 | `api.problem-details-errors` | ⚠️ SHOULD | [`api/orders.yaml:88-95`](https://github.com/acme/shop/blob/3f2a91c/api/orders.yaml#L88-L95) |

### 🛑 Blocking findings

#### 1. `payments.no-floating-point-money` — MUST NOT

📄 [`src/billing/invoice.ts`, lines 41–44](https://github.com/acme/shop/blob/3f2a91c/src/billing/invoice.ts#L41-L44)

```diff
+ const total: number = subtotal * 1.2
```

The invoice total is computed and stored as a floating-point number.
Floating-point rounding can produce incorrect payment amounts.

> 💡 **How to fix:** Use the Money value object or an integer in the
> smallest currency unit.
> 📚 [engineering.example.com/decisions/money-values](https://engineering.example.com/decisions/money-values)

#### 2. `security.no-secrets-in-code` — MUST NOT

📄 [`src/config/stripe.ts`, line 8](https://github.com/acme/shop/blob/3f2a91c/src/config/stripe.ts#L8)

```diff
+ const stripeKey = "sk_live_…"
```

A live API key is committed in source code instead of read from the
environment.

> 💡 **How to fix:** Read the key from `STRIPE_API_KEY` and rotate the
> committed key immediately.

### ⚠️ Warnings

Warnings do not block the merge by themselves.

<details>
<summary><b>3.</b> <code>api.problem-details-errors</code> — SHOULD · <code>api/orders.yaml:88-95</code></summary>

```yaml
error: { type: string }
```

The error response defines an ad-hoc shape instead of the Problem Details
format. A shared error shape makes clients and operational tools simpler.

> 💡 **How to fix:** Return `application/problem+json` with `type`,
> `title`, and `status`.

</details>

### 🔇 Suppressed

> [!NOTE]
> Suppressed findings were not verified and do not change the conclusion.
> The marker and its reason are part of this change — review them like
> code.

| Rule | Level | Location | Author's reason |
| --- | --- | --- | --- |
| `payments.no-floating-point-money` | MUST NOT | [`src/billing/estimate.ts:12`](https://github.com/acme/shop/blob/3f2a91c/src/billing/estimate.ts#L12) | display-only estimate, PAY-421 |

> [!WARNING]
> **1 invalid suppression marker** has no effect:
> [`src/billing/refund.ts:33`](https://github.com/acme/shop/blob/3f2a91c/src/billing/refund.ts#L33) —
> `standards-allow payments.no-float:` names a rule that is not in the
> resolved rule set.

<details>
<summary>📊 <b>Review details</b> — 24 rules resolved · 6 selected · 3 evaluation tasks · 47,150 tokens</summary>

| Findings | Count |
| --- | ---: |
| 🛑 MUST / MUST NOT | 2 |
| ⚠️ SHOULD / SHOULD NOT | 1 |
| 🔇 Suppressed | 1 |

| Agent step | Model | Invocations | Input tokens | Output tokens |
| --- | --- | ---: | ---: | ---: |
| Evaluation | `anthropic/claude-sonnet-5` | 3 | 41,200 | 1,810 |
| Verification | `anthropic/claude-opus-5` | 3 | 3,900 | 240 |

Every finding above was confirmed by an independent verification pass.
Rejected findings are not shown.

</details>

---
🔍 Reviewed [`3f2a91c`](https://github.com/acme/shop/commit/3f2a91c) against merge base [`a1b04dd`](https://github.com/acme/shop/commit/a1b04dd) · [What is Standards?](https://github.com/nlecoy/standards)
````

The first finding renders the same data as the JSON report example in
[Standards review](./review.md). The alert callouts, the emoji, and the
`diff` evidence styling are presentation choices; the data each element
carries is normative, the styling is not. The evidence quote renders
untrusted change content; the quote length limits in that document bound
what a manipulated change can display.

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
