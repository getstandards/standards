# Standards GitHub Action

Defines how Standards reviews pull requests on GitHub.

## Purpose

The GitHub Action is the automation surface of Standards. It runs
`standards review` for a pull request and reports the result where reviewers
already look: a check run that carries the verdict, one finding comment on
each confirmed finding's changed lines, and one summary comment on the pull
request. When a confirmed finding has a suggested change, its finding comment
lets an authorized user apply that replacement through GitHub.

This document specifies the action's workflow integration, authentication,
inputs, run behavior, and reporting surfaces.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the GitHub surface only. The review pipeline, model
selection, and the report content are defined in
[Standards review](./review.md). Credentials are defined in
[Standards provider credentials](./credentials.md). The step log, the check
run summary, the finding comments, and the summary comment render the same
report data as a terminal run; this document defines where that data
appears on GitHub and how the comments lay it out.

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
      - uses: getstandards/standards@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

The action needs these token permissions and no others:

| Permission | Used for |
| --- | --- |
| `contents: read` | Reading the repository checkout. |
| `checks: write` | Creating and completing the check run. |
| `pull-requests: write` | Creating the finding comments; creating and updating the summary comment. |

The review compares the pull request's head commit against the merge base of
the head commit and the base branch. The checkout MUST contain the head
revision and the merge base; the example uses `fetch-depth: 0` for this
reason. The action MUST fail with a diagnostic when the merge base is not in
the checkout.

## Authentication

The action authenticates to GitHub with the token given in the
`github-token` input. The default is the workflow's `GITHUB_TOKEN`.

A GitHub App is not required. Every surface defined here — the check run, the
finding comments, and the summary comment — works with the workflow token
and the permissions above. A GitHub App becomes necessary only for behavior
this version excludes: review verdicts and review dismissal, resolving or
deleting finding comments, a branded bot identity, and actions outside the
triggering repository.

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
| `provider-env` | No | Names of extra provider credential variables, separated by spaces or commas. The action forwards each named variable from the step environment to the review. |

The action is a thin surface: each input maps to one environment variable of
`standards review`, and selection precedence stays as defined in
[Standards review](./review.md). The action MUST NOT add its own precedence
rules. An unknown input is rejected by GitHub Actions itself.

The three API key inputs cover the principal providers defined in
[Standards provider credentials](./credentials.md). The pi AI SDK registers
more providers, and some need more than one value. A workflow selects such a
provider by setting its variables on the step with `env:` and naming them in
`provider-env`:

```yaml
      - uses: getstandards/standards@v1
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          model: openrouter/deepseek/deepseek-v4
          provider-env: OPENROUTER_API_KEY
```

The review reads only the variables the three key inputs map to and the
variables named in `provider-env`. An ambient variable on a self-hosted
runner that is not named MUST NOT reach the review. A provider without a
default model in [Standards review](./review.md) also needs a model input.

Provider API keys MUST be passed from repository or organization secrets.
At least one provider credential must resolve, through a key input or a
variable named in `provider-env`; [Run behavior](#run-behavior) defines what
happens when none does.

## Outputs

The action sets outputs that later steps of the same job can read, for
example in an `if:` condition or a notification step:

| Output | Meaning |
| --- | --- |
| `conclusion` | The review conclusion: `compliant` or `non-compliant`. |
| `blocking-count` | The number of confirmed `MUST` and `MUST NOT` findings. |
| `warning-count` | The number of confirmed `SHOULD` and `SHOULD NOT` findings. |
| `total-cost` | The total cost of the review in United States dollars, with four decimal places, such as `0.0523`. The report's `cost_basis` states whether the value is a charge or an estimate. |
| `report-file` | The path of the JSON review report on the runner. |

The report file carries the same JSON report as
`standards review --format json`, defined in [Standards review](./review.md).
The action writes it to the runner's temporary directory.

The action sets the outputs only when it completes a review. A skipped fork
run, a cancelled run, and a failed run set none, so a later step reads every
output as an empty string. A step that gates on the review MUST therefore
test for an explicit value, for example
`if: steps.standards.outputs.conclusion == 'non-compliant'`.

The counts cover confirmed findings only. A suppressed finding is not
counted; it stays visible in the report.

## Run behavior

One run reviews one pull request head:

1. Create a check run named `Standards` for the head commit, in progress.
2. Resolve the configuration, the lock file, and the selected models, and
   run the review pipeline defined in [Standards review](./review.md).
3. Write the report to the step log.
4. Complete the check run with the conclusion and the report as its summary.
5. Create one finding comment per new confirmed finding.
6. Create or update the summary comment.
7. Exit with the status that matches the outcome.

| Review outcome | Check run conclusion | Exit status |
| --- | --- | --- |
| Compliant | `success` | `0` |
| Non-compliant | `failure` | `0` |
| Skipped fork run without credentials | `neutral` | `0` |
| Invalid configuration, resolution failure, or execution failure | `failure` | `2` |
| Cancelled run | `cancelled` | none |

A completed review exits with status `0` whatever the conclusion. The
verdict surface is the `Standards` check run, not the workflow job: a red
job for a non-compliant review would repeat the check run's signal and make
a rule violation look like a tool failure. This deliberately differs from
the checking command convention in [Standards CLI](./cli.md), where
`standards review` exits with status `1` on a non-compliant conclusion. A
terminal run has no check run to carry the verdict; the action does.

A repository gates merging by requiring the `Standards` check in branch
protection or a repository ruleset. GitHub does not block a merge on a
failed check that is not required, so a non-zero exit status would not gate
merging either; it would only fail the job. A workflow step that must react
to the conclusion reads the `conclusion` output.

Status `2` marks a run that could not complete: an invalid configuration, a
resolution failure, or an execution failure. It fails the job because a
maintainer must fix the setup. A failure conclusion MUST carry the
diagnostic or the report in the check run summary; a red check with an
empty summary is not actionable.

A re-run for the same head commit creates a new check run and updates the
same summary comment. A run cancelled by the workflow, for example by the
`concurrency` group when a new commit arrives, MUST complete its check run
as `cancelled` when it can still reach the API.

### Step log

The job log is where a user investigates a run first. The action MUST
write the report to the step log on standard output: the plain text
rendering defined in [Standards CLI](./cli.md), without color codes or
glyphs. After the report, the action MUST write one line that states the
conclusion, the finding counts, and where the full result appears, for
example:

```text
Non-compliant: 2 blocking findings, 1 warning. See the Standards check run and the pull request comments.
```

A log that ends without a report or a diagnostic is not actionable, so a
run that fails MUST write its diagnostic to the step log in addition to the
check run summary.

### Finding comments

A finding comment is one pull request review comment that carries one
confirmed finding, anchored to the finding's `path` and `lines` at the head
commit. The action MUST create one finding comment per new confirmed
finding. It SHOULD post them in one pull request review with the `COMMENT`
event and no body, so the review expresses no verdict and reviewers get one
notification.

The comment's first line is a hidden marker:

```text
<!-- standards:finding:v1:<fingerprint> -->
```

The marker version is independent of the report format version. Suggested
changes do not change the marker format, so the marker stays at version 1.

The fingerprint identifies a finding when GitHub can no longer map its comment
to the current diff. It is the first sixteen characters of the lowercase
hexadecimal SHA-256 digest of the rule `id`, the `path`, and the source anchor,
joined with a newline. The source anchor is the exact text from the first
through the last finding line in the finding revision. The finding revision is
the head revision, or the base revision for a deleted file. The action MUST
represent line separators as `\n` and MUST omit a final line break from the
source anchor before it computes the digest.

The fingerprint MUST NOT contain model output. The `evidence`, `reason`, and
`suggested_change` are not stable across runs and MUST NOT affect finding
identity. The line numbers are not part of the digest. A push that only moves
an unchanged source anchor within the same path does not change its
fingerprint.

Before posting, the action MUST list its existing finding comments on the pull
request. It MUST treat an existing comment as the same finding when the
comment names the same rule and path and its GitHub-mapped current line range
overlaps the new finding's line range. This range check is primary because an
agent can select different but overlapping ranges for the same violation.

GitHub does not provide a current line range for some outdated comments. For
such a comment, the action MUST treat it as the same finding when its
fingerprint equals the new finding's fingerprint. The action MUST NOT use an
equal fingerprint to merge two comments that have mapped, non-overlapping
current ranges. Identical source text can identify separate violations in one
file.

The action MUST skip a finding that matches an existing finding comment by
either check. A re-run for the same or a new head commit MUST NOT create a
second comment for the same finding. The action MUST NOT edit, resolve, or
delete a finding comment; the thread belongs to the reviewers.

GitHub rejects a review comment whose location is not part of the pull
request diff. When a finding cannot be anchored, the action MUST render
that finding expanded in the summary comment instead, so no finding is
silently dropped. A suppressed finding MUST NOT produce a finding comment;
it stays visible in the report, as defined in
[Standards suppressions](./suppressions.md).

The comment body is short prose under the annotated lines. It opens with a
severity emoji — 🛑 for `MUST` and `MUST NOT`, 🟡 otherwise — and the `reason`
in bold. When the finding has an applicable suggested change, a GitHub
`suggestion` code block follows the reason. The rule's `guidance` follows as a
💡 line and each of its `references` as a 📚 line, when present. A footer
carries the `level`, the rule `id`, and the product name, so the headline stays
pure prose. The comment MUST NOT quote the `evidence`: the annotated lines sit
directly above it. Example:

````markdown
<!-- standards:finding:v1:9f31c60a55e2b7d4 -->
🛑 **The invoice total is computed and stored as a floating-point number.
Floating-point rounding can produce incorrect payment amounts.**

```suggestion
const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);
```

💡 Use the Money value object or an integer in the smallest currency unit.
📚 [engineering.example.com/decisions/money-values](https://engineering.example.com/decisions/money-values)

<sub>MUST NOT · `payments.no-floating-point-money` · Standards review</sub>
````

A suggested change is applicable when all these conditions are true:

- The finding is anchored to the right side of the pull request diff at the
  head commit.
- Every line in the finding range is in one diff hunk.
- The complete comment, including the exact replacement, fits within GitHub's
  comment size limit.

The action MUST put the exact `suggested_change` value inside the suggestion
block. It MUST NOT reindent, escape, truncate, or otherwise modify the
replacement. It MUST use a Markdown fence that the replacement cannot close.
If the complete comment is too large, the action MUST omit the suggestion
block and post the finding comment without it.

If GitHub rejects a finding comment that contains a suggestion block, the
action MUST retry that finding once without the suggestion block. If GitHub
also rejects the plain finding comment, the action treats the finding as
unanchored and renders it in the summary comment.

The finding comment renders the same finding as the JSON report example in
[Standards review](./review.md), without the `evidence` quote.

### Summary comment

The summary comment is one pull request comment that carries the report. The
action finds it by a hidden marker that MUST be the comment's first line:

```text
<!-- standards:report:v1 -->
```

The summary marker version is also independent of the report format version.
The marker stays at version 1 because its format does not change.

- When a comment with the marker exists, the action MUST update it in place.
- When none exists and the review produced findings, or failed, the action
  MUST create it.
- When none exists and the review is compliant without findings, the action
  MUST NOT create one. A clean run adds no noise; the check run already
  reports success.
- The action MUST NOT create a second comment with the marker.

### Comment layout

The summary comment is the index of the review. The per-finding detail
lives in the finding comments, so the summary comment MUST NOT repeat a
finding that has a finding comment beyond one overview row. It renders the
report data in this order. A section with no entries MUST NOT render:

1. A heading with the conclusion.
2. An alert callout with the merge verdict and the finding counts:
   blocking, warnings, and suppressed. It notes that each confirmed
   finding has a review comment on its lines.
3. An overview table of the confirmed findings: number, rule `id`,
   `level`, and linked location.
4. Findings without a finding comment — findings whose location could not
   be anchored to the diff — expanded, blocking first. An expanded finding
   shows its rule `id` and `level`, its `path` and `lines` as a link, the
   `evidence` quote in a `diff` code block as an added line, the `reason`,
   the suggested change as a plain replacement block when present,
   and the rule's `guidance` and `references` when present, set off as a quoted
   fix block. The replacement block MUST NOT use GitHub's `suggestion` type
   because it is not attached to an applicable diff range.
5. Suppressed findings as a table: rule `id`, `level`, linked location, and
   the marker's reason, with a note that a suppressed finding was not
   verified. Invalid suppression markers follow as an alert callout with
   each marker's location and problem.
6. A collapsed details block with the counts — resolved rules, selected
   rules, evaluation tasks, findings for each level — and the model,
   invocation count, token usage, and cost of each agent step, with the
   review's total cost as the usage table's last row. The row reads the
   report's `total_cost`. A cost basis other than `charged` adds a short
   note under the table. It states that every reported finding was
   confirmed by verification.
7. A footer that links the reviewed head commit and the merge base, so an
   updated comment shows which push it describes.

A location MUST link to the file at the head commit, not to the diff view,
so the link stays valid after later pushes.

A compliant review that produced warnings or suppressed findings uses the
same layout with the compliant conclusion. Example:

````markdown
<!-- standards:report:v1 -->
## 🛑 Standards review — Non-compliant

> [!CAUTION]
> **2 blocking findings** must be resolved or suppressed with a reason
> before this pull request can merge. 1 warning and 1 suppressed finding
> are listed below. Each confirmed finding has a review comment on its
> lines.

| # | Rule | Level | Location |
| --- | --- | --- | --- |
| 1 | `payments.no-floating-point-money` | 🛑 MUST NOT | [`src/billing/invoice.ts:41-44`](https://github.com/acme/shop/blob/3f2a91c/src/billing/invoice.ts#L41-L44) |
| 2 | `security.no-secrets-in-code` | 🛑 MUST NOT | [`src/config/stripe.ts:8`](https://github.com/acme/shop/blob/3f2a91c/src/config/stripe.ts#L8) |
| 3 | `api.problem-details-errors` | ⚠️ SHOULD | [`api/orders.yaml:88-95`](https://github.com/acme/shop/blob/3f2a91c/api/orders.yaml#L88-L95) |

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

| Agent step | Model | Invocations | Input tokens | Output tokens | Cost |
| --- | --- | ---: | ---: | ---: | ---: |
| Evaluation | `anthropic/claude-sonnet-5` | 3 | 41,200 | 1,810 | $0.0421 |
| Verification | `anthropic/claude-opus-5` | 3 | 3,900 | 240 | $0.0102 |
| Total | | | | | $0.0523 |

Every finding above was confirmed by an independent verification pass.
Rejected findings are not shown.

</details>

---
🔍 Reviewed [`3f2a91c`](https://github.com/acme/shop/commit/3f2a91c) against merge base [`a1b04dd`](https://github.com/acme/shop/commit/a1b04dd) · [What is Standards?](https://github.com/getstandards/standards)
````

The alert callouts, the emoji, and the `diff` evidence styling are
presentation choices; the data each element carries is normative, the
styling is not. The evidence quotes in the finding comments and the summary
comment render untrusted change content; the quote length limits in
[Standards review](./review.md) bound what a manipulated change can
display. The check run summary MUST show each suggested change as a plain
replacement block. A renderer MUST omit a suggested change rather than
truncate its replacement.

## Fork pull requests

GitHub withholds repository secrets from `pull_request` runs for pull
requests from forks, so provider API keys are absent and the review cannot
run. In that case the action MUST complete the check run as `neutral` with a
summary that explains why the review was skipped, and exit with status `0`.
A fork contributor cannot fix a missing secret, so their pull request MUST
NOT turn red for it.

When no provider credential resolves, through a key input or a variable
named in `provider-env`, and the pull request is not from a fork, the run is
a setup error: the action MUST fail with a diagnostic that names the missing
inputs.

The action MUST NOT be used with the `pull_request_target` event. That event
hands repository secrets to a run whose review reads `.standards.yml`, the
lock file, and the rules from the fork's head revision, and the change
content itself is untrusted input to the agents. Reviews of fork pull
requests wait for the trust policy excluded by
[Standards configuration format](./configuration.md).

## Security considerations

- The workflow token needs only the three permissions listed above. The
  action never needs `contents: write`. The action posts a suggestion but does
  not apply it or push a commit. GitHub applies it only when an authorized user
  chooses to apply it.
- Provider API keys are secrets. Logs, the check run summary, and the
  summary comment MUST NOT contain them, as required by
  [Standards provider credentials](./credentials.md).
- The action MUST NOT restore the source cache from a CI cache service, as
  required by [Standards source cache](./cache.md). Each run starts with an
  empty cache on an ephemeral runner.
- Change content is untrusted input to the review agents;
  [Standards review](./review.md) defines those rules. The check run
  summary and the summary comment render finding evidence, which quotes the
  change; the quote length limits in that document bound what a manipulated
  change can display. A finding comment quotes no evidence; its `reason` is
  model output derived from the change, which that document bounds to one
  or two sentences. A suggested change is also model output. The action MUST
  present it as a proposal and MUST NOT claim that repository checks passed
  with it.

## Version 2 exclusions

This version does not define:

- Review verdicts (`APPROVE`, `REQUEST_CHANGES`) and review dismissal. The
  finding comments carry the findings without a verdict.
- Editing, resolving, or deleting finding comments. A posted comment stays
  as the reviewers' thread, even after the finding is fixed.
- A hosted GitHub App or a recommended app configuration.
- Reviews of fork pull requests with repository secrets.
- `push`, `merge_group`, or `workflow_dispatch` events.
- Comment commands, such as re-running or suppressing a finding from the
  pull request thread.
- Reactions to, or deduplication against, comments from humans or other
  bots.
