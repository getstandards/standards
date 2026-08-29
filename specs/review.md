# Standards review

Defines how Standards runs a review.

## Purpose

A review evaluates a change — the hunks of one change scope — against the
resolved rule set and reports the result. The change can come from anywhere: a
pull request, a local branch, or the uncommitted state of a working tree. This
document specifies the review pipeline: its steps, which steps use an agent,
what each step receives and returns, and the rules that keep token use low.

The pipeline has one economic goal: spend the minimum number of model tokens
for the maximum number of correct findings. Two design rules follow from this
goal:

- A model MUST NOT be used for work that deterministic code can do.
- An agent MUST receive only the context that its task needs.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the execution of one review, including how a review
selects its model. It does not specify:

- The configuration format, the knowledge document format, or resolution.
  [Standards configuration format](./configuration.md) defines them.
- Provider credentials and the `auth` commands.
  [Standards provider credentials](./credentials.md) defines them.
- The settings file that stores personal defaults, including model defaults.
  [Standards settings](./settings.md) defines it.
- The option surface of `standards review`. [Standards CLI](./cli.md) defines
  the CLI.
- The delivery surface. A terminal, a step log, a check run, and pull
  request comments render the same report data.
  [Standards GitHub Action](./github.md) defines the GitHub surfaces.

## Inputs

A review has four inputs:

| Input | Meaning |
| --- | --- |
| Change scope | The change the review compares. [Change scope](#change-scope) defines it. |
| Targets | An optional set of repository-relative paths that limits the review. An empty set means the whole change. |
| Rule set | The ordered rule list produced by resolution. |
| Selected models | The provider and model that run each agent step. |

[Model selection](#model-selection) defines how the selected models are
resolved.

The invoking surface, such as the CLI or the GitHub Action, selects the change
scope and supplies the targets. Resolution follows
[Standards configuration format](./configuration.md): each Git source's
`branch` resolves to its current commit at the start of the run, and the report
records the resolved commits. The invoking surface MAY give the review a rule
set that is smaller than the resolved one, as the `--rule` and `--folder`
options of [Standards CLI](./cli.md) do. The rule set the review receives is
the one the report's `resolved_rules` count reports.

### Change scope

A review compares exactly one change scope. The scope has a base side and a
head side. There are three kinds:

| Kind | Change | Git diff |
| --- | --- | --- |
| `commits` | Between two commits. | `git diff <base> <head>` |
| `working-tree` | Between a base commit and the working tree, staged and unstaged changes included, untracked files included as added files. | `git diff <base>` plus one `--no-index` diff per untracked file |
| `staged` | Between `HEAD` and the index: only the staged changes. | `git diff --cached` |

Every scope produces the same changed-file shape, and every pipeline step runs
on it without modification. An untracked file MUST be included in the
`working-tree` scope only when Git does not ignore it, as
`git ls-files --others --exclude-standard` reports.

The agents read extra context from the working tree, which is the head side of
the `working-tree` scope. For a `commits` scope whose head is not the
checked-out commit, and for a `staged` scope whose working tree differs from
the index, that context can disagree with the reviewed change. The
implementation does not check out the head side; this specification states the
mismatch instead.

The `--base`, `--range`, `--staged`, and `--all` options of
`standards review`, defined in [Standards CLI](./cli.md), select the scope. The
GitHub Action always selects a `commits` scope.

### Full review

A full review evaluates the whole project instead of one change. The
invoking surface selects the empty tree as the base revision. Git resolves
the empty tree in every repository, so the change contains every file of the
head side as an added file. Every pipeline step runs on this
change without modification. Targets apply as in any review: they restrict
the full review to the files they match. The `--all` option of
`standards review`, defined in [Standards CLI](./cli.md), requests a full
review over the `working-tree` scope, so untracked files are audited too.

A full review is an audit, not a merge gate. It shows what the rule set
finds in the code that exists today: before a repository adopts a rule set,
or after a rule set change. Suppression markers in the head revision apply
as in any review.

A full review sends every selected file through the evaluation step, so its
token cost grows with the repository, not with a change. The report's
counts and usage show that cost. The implementation SHOULD
report the number of selected files and evaluation tasks as progress before
the evaluation step starts, so a user can interrupt a run that is larger
than expected.

## Model selection

Each agent step, evaluation and verification, runs on one selected model. A
user selects one model for both steps, or a different model for each step.
Without a per-step selection, both steps use the same model.

Model selection belongs to the user who runs the review, not to the shared
rule set. A rule set is shared between repositories and organizations that
run different providers, so `.standards.yml` MUST NOT name a provider or a
model. A user saves personal model defaults in the settings file, defined in
[Standards settings](./settings.md).

### Provider SDK

The implementation MUST access every provider through the pi AI SDK
(`@earendil-works/pi-ai`) from the [pi agent](https://github.com/earendil-works/pi)
project. The SDK gives one API across providers, discovers models, and
implements the OAuth flows for subscription accounts. The implementation MUST
NOT add a second provider integration path next to the SDK.

A provider is one model service that the SDK supports, named by its SDK
provider name in lower case: `anthropic`, `openai`, `google`, and the other
names the SDK defines. Standards defines default models for the providers in
[Default models](#default-models). Any other provider that the SDK supports
MAY be used with an explicit model reference and an API key.

### Model reference

A model reference selects the model for one or both agent steps. It has the
form:

```text
<provider>/<model>
```

`<provider>` is the SDK provider name. `<model>` is the provider's model
identifier, passed to the SDK without change. Examples:

```text
anthropic/claude-sonnet-5
openai/gpt-5.5
google/gemini-3.1-pro
```

A reference without a `/`, with an unknown provider, or with an empty model
MUST produce a diagnostic that shows the expected form and the known
providers. It MUST exit with the invoking command's error status, defined in
[Standards CLI](./cli.md): status `2` for the checking command
`standards review`. A model that the provider rejects MUST surface the
provider's error in a diagnostic.

### Selection precedence

The implementation MUST resolve the selected model of each agent step in this
priority order:

1. The step's own option of `standards review`, defined in
   [Standards CLI](./cli.md): `--evaluation-model <provider>/<model>` for
   evaluation, `--verification-model <provider>/<model>` for verification.
2. The `--model <provider>/<model>` option, which covers both steps.
3. The step's own environment variable: `STANDARDS_EVALUATION_MODEL` or
   `STANDARDS_VERIFICATION_MODEL`.
4. The `STANDARDS_MODEL` environment variable.
5. The step's own settings field: `evaluation_model` or
   `verification_model`, defined in [Standards settings](./settings.md).
6. The `model` settings field, which covers both steps.
7. The default model of the one provider that has a usable credential.
   [Standards provider credentials](./credentials.md) defines credentials.

Between sources, an option wins over an environment variable, and an
environment variable wins over a settings field. Within one source, the
per-step input wins over the shared input. An environment variable and a
settings field follow the same format and validation as the matching
option. Each step resolves independently, so the
two steps can run on different models and different providers. Every
resolved provider MUST have a usable credential; a selection that names a
provider without one MUST fail with a diagnostic that names that provider
and the credential sources.

Fallback 7 MUST be unambiguous:

- When exactly one provider has a usable credential, the step uses that
  provider's default model.
- When no provider has a usable credential, the review MUST fail with a
  diagnostic that names the credential sources, `standards auth login` or a
  provider API key environment variable, and names `standards models` as the
  command that lists the usable model references.
- When more than one provider has a usable credential, the review MUST fail
  with a diagnostic that lists those providers, asks for an explicit
  selection, and names `standards models`. The implementation MUST NOT pick
  one silently.

Verification overrides evaluation, so a finding is only as trustworthy as the
verifier. The verification model SHOULD NOT be weaker than the evaluation
model. The inverse split is the useful one: a cheaper evaluation model with a
stronger verification model spends fewer tokens on the broad pass and more on
the small set of findings.

### Default models

A default model is the model an agent step uses when the user selects only a
provider, through its credential, and no model reference. The default SHOULD
be the provider's current general model that balances review accuracy against
token cost.

| Provider | Default model |
| --- | --- |
| `anthropic` | `claude-sonnet-5` |
| `openai` | `gpt-5.5` |
| `google` | `gemini-3.1-pro` |

Providers change their model lineups outside of Standards releases. A
Standards release MAY change a default model without a configuration format
change. The `--help` output of `standards review` MUST show the current
defaults. A provider without a default in this table requires an explicit
model reference.

## Pipeline

A review runs five steps in order:

| # | Step | Executor | Input | Output |
| --- | --- | --- | --- | --- |
| 1 | Selection | Deterministic | Rule set, changed files, targets | Selected rules per file |
| 2 | Planning | Deterministic | Selected rules, hunks | Evaluation tasks |
| 3 | Evaluation | One agent per task | Task rules, task hunks | Rule verdicts with findings and candidate suggested changes |
| 4 | Verification | One agent per finding | Finding, rule, code region | Confirmed findings with accepted suggested changes |
| 5 | Report | Deterministic | Confirmed findings | Report and conclusion |

Evaluation and verification are the only steps that use a model. Every other
step MUST be deterministic: the same change and the same rule set MUST produce
the same selection, the same tasks, and the same report structure.

### Step 1: Selection

Selection computes the changed files from the change. When the review has
targets, selection MUST then discard every changed file that no target
matches. A target matches a file when it equals the file's path or is a
directory prefix of it. A deleted file matches a target through its base
path. Target filtering is deterministic and uses zero model tokens.

Selection then matches every rule's `applies_to` filter against the
remaining files:

- A modified or added file matches with its head path.
- A renamed file matches with its head path.
- A deleted file matches with its base path.
- A binary file is not evaluated and is excluded from selection.

A rule with no matching changed file is discarded for this review.

When selection discards every rule, the review MUST skip to the report step
with a compliant conclusion. This early exit uses zero model tokens.

### Step 2: Planning

Planning packs the selected rules and their hunks into evaluation tasks.

Tasks group by file, not by rule. Hunks are almost always larger than rule
text, so per-file grouping sends each hunk to a model once, while per-rule
grouping would send the same hunk once per rule. Therefore:

- Each changed file MUST appear in exactly one evaluation task, together with
  all rules selected for it.
- A task MAY contain several files. The implementation SHOULD pack small files
  into shared tasks, and SHOULD keep files that share the same rule subset in
  the same task.

Planning MUST be deterministic so that a review is reproducible and
auditable.

### Step 3: Evaluation

Each evaluation task runs as one agent invocation. Tasks are independent and
MAY run concurrently, bounded by the concurrency limit defined in
[Standards review concurrency](./concurrency.md). The implementation MAY
report the count of finished tasks while the step runs, so an interactive
surface can show a loading status.

The agent receives:

- For each task rule: `id`, `level`, the rule statement (`title`), the
  `description` when it is not empty, and the full markdown body. Fields that
  the agent does not need MUST NOT be sent.
- The task's hunks, with enough surrounding lines to read them.

The agent MAY read more content from the head checkout when a hunk alone is
not enough to judge a rule. The agent MUST NOT read outside the head checkout
and MUST NOT fetch URLs.

The agent returns one verdict for every rule and file pair in the task, and
nothing else. The verdict list is a checklist: the agent cannot return
without a decision on every rule, which guards recall when one task carries
several rules.

| Field | Meaning |
| --- | --- |
| `rule` | The judged rule's `id`. |
| `path` | The changed file path. |
| `verdict` | `compliant` or `violated`. |
| `findings` | One finding per violation. Empty when the verdict is `compliant`. |

Each finding carries:

| Field | Meaning |
| --- | --- |
| `first_line` | The first violating line in the head revision, or in the base revision for a deleted file. |
| `last_line` | The last violating line, in the same revision as `first_line`. |
| `evidence` | A short quote from the change that shows the violation. |
| `reason` | One or two sentences that connect the evidence to the rule. |
| `suggestion` | Optional remediation advice, specific to the change. Prose, never replacement code. |
| `suggested_change` | An optional exact replacement for every line from `first_line` through `last_line`. |

The evaluation agent SHOULD include `suggested_change` when it can make a
small, exact change that resolves the finding. The value is replacement text,
without a Markdown fence. It MUST be non-empty, MUST replace the complete
range, and MUST NOT describe edits outside that range. It uses `\n` between
replacement lines and has no final line break.

The evaluation agent MUST omit `suggested_change` when:

- The finding is in a deleted file.
- The correct change only deletes the finding's line range.
- The change needs edits outside the finding's line range or in another file.
- The correct replacement needs a product decision, a secret, or information
  that the agent cannot confirm from the head checkout.
- The agent cannot confirm that an exact replacement resolves the finding.

The rule body can help the agent produce a suggested change, but it is not a
replacement template. The agent MUST check the surrounding code and MUST NOT
copy rule text into `suggested_change` unless that text is the exact
replacement. The suggested change SHOULD preserve the file's existing format
and MUST NOT include unrelated cleanup.

The agent MUST NOT return a prose report. The implementation MUST discard
compliant verdicts and keep only the findings of violated verdicts; the
report derives coverage from the plan, not from agent output. File
applicability is a filter, not proof of relevance, so the agent MUST mark a
rule compliant when it does not apply to the change it sees.

### Step 4: Verification

A finding that reaches the report must be worth a reviewer's time. A false
finding costs more trust than the tokens needed to check it. Verification
therefore re-checks every finding before it is reported.

Before verification, the implementation MUST deduplicate findings
deterministically: two findings are duplicates when they name the same rule
and path and their line ranges overlap. It MUST then remove suppressed
findings, as defined in [Standards suppressions](./suppressions.md). A
suppressed finding skips verification and appears in the report as
suppressed; it cannot change the conclusion, so verifying it would spend
tokens on nothing.

This comparison does not use `evidence`, `reason`, `suggestion`, or
`suggested_change`. These fields are agent output and can differ between
evaluations of the same change. GitHub publishing applies the same rule, path, and overlapping-range
identity to finding comments that GitHub can map to the current diff, as
defined in [Standards GitHub action](./github.md).

Each remaining finding runs as one independent agent invocation with fresh
context: the rule fields from evaluation, the finding, its candidate suggested
change when present, and the code region around `lines`. The verifier does not
receive the evaluation task's other rules, files, or findings. The
invocations MAY run concurrently, bounded by the concurrency limit defined in
[Standards review concurrency](./concurrency.md). The implementation MAY
report the count of finished findings while the step runs, so an interactive
surface can show a loading status.

Before the invocation, deterministic code MUST remove a candidate suggested
change when the file does not exist in the head revision, the line range is not
valid in that file, or the replacement is identical to the current line range.
Removing the candidate MUST NOT remove the finding.

The verifier confirms or rejects the finding:

- It MUST reject a finding whose evidence does not establish the violation.
- For a `SHOULD` rule, it MUST reject a finding when the change documents a
  valid reason for the exception.
- It MUST NOT weaken or reword the rule.

When the finding has a candidate suggested change, the verifier separately
accepts or rejects it. The verifier MUST accept it only when the replacement:

- Resolves the finding without weakening the rule.
- Is valid for the complete finding line range.
- Uses names and behavior that the verifier can confirm from the head
  checkout.
- Makes no unrelated change.

The verifier MUST NOT create or modify a suggested change. This keeps the
replacement independent from the agent that checks it. A rejected suggested
change is removed, but its confirmed finding remains. An accepted candidate
becomes the finding's suggested change in the report.

Rejected findings are dropped from the report. The implementation MAY log
them for diagnosis.

### Step 5: Report

The report step is deterministic rendering. It MUST NOT use a model.

The implementation sorts confirmed findings by path, then line, then rule
`id`, and computes the conclusion:

| Conclusion | Condition |
| --- | --- |
| Non-compliant | At least one confirmed `MUST` finding. |
| Compliant | Every other case. |

A confirmed `SHOULD` finding is a warning. It appears in the report but does
not change the conclusion by itself.

The report MUST include:

- The conclusion.
- The provider and model that ran each agent step.
- Counts: resolved rules, selected rules, evaluation tasks, and findings for each
  level.
- Model usage for each agent step: the number of invocations and the token
  counts that the provider reported. `input_tokens` counts the uncached
  input tokens; `cache_read_tokens` and `cache_write_tokens` count the input
  tokens the provider served from and wrote to its cache. The pipeline's
  goal is minimum tokens; the report is where a user sees that goal met.
- The cost of the review in United States dollars: the `cost` of each agent
  step and their sum as `total_cost`. The rates come from the provider
  SDK's model catalog. The implementation MUST accumulate the SDK-computed
  cost of each request as it finishes, and MUST NOT compute a cost from
  summed token counts: request-wide pricing tiers apply per request, so a
  cost computed from summed tokens could cross a tier threshold that no
  single request crossed. A renderer MUST read `total_cost` and MUST NOT
  recompute it, so the report and its renderings can never disagree.
- The `cost_basis`, which states what the cost number means: `charged` for
  an API key credential, `list_price_estimate` for a subscription
  credential, and `none` when every selected model has a zero cost. One
  review runs on one credential, so the field belongs to the review, not to
  a step. A text surface MUST add a short note when the value is not
  `charged`, so an estimate is never presented as a charge.
- The resolved commit of each Git knowledge source, for traceability.
- The warnings for skipped knowledge documents, as defined in
  [Standards configuration format](./configuration.md).
- Each confirmed finding with its rule `id`, `level`, the rule statement
  (`title`), the rule `description` when it is not empty, `path`, `lines`,
  `evidence`, `reason`, the `suggestion` when present, and the accepted
  `suggested_change` when present.
- Each suppressed finding and each invalid suppression marker, as defined in
  [Standards suppressions](./suppressions.md).

### Machine-readable report

The report is one data shape that every surface renders. With
`--format json`, defined in [Standards CLI](./cli.md), the review writes it
as one JSON document:

```json
{
	"version": 3,
	"conclusion": "non-compliant",
	"models": {
		"evaluation": "anthropic/claude-sonnet-5",
		"verification": "anthropic/claude-opus-5"
	},
	"counts": {
		"resolved_rules": 24,
		"selected_rules": 6,
		"evaluation_tasks": 3
	},
	"usage": {
		"evaluation": {
			"invocations": 3,
			"input_tokens": 41200,
			"cache_read_tokens": 38400,
			"cache_write_tokens": 2800,
			"output_tokens": 1810,
			"cost": 0.0421
		},
		"verification": {
			"invocations": 2,
			"input_tokens": 3900,
			"cache_read_tokens": 0,
			"cache_write_tokens": 0,
			"output_tokens": 240,
			"cost": 0.0102
		},
		"total_cost": 0.0523,
		"cost_basis": "charged"
	},
	"sources": [
		{
			"repository": "https://github.com/example/engineering-knowledge",
			"branch": "main",
			"commit": "9d64a5838f8dbf26f0f1e51078a29c756970ca31"
		}
	],
	"warnings": [
		{
			"document": "https://github.com/example/engineering-knowledge@main:decisions/broken.md",
			"problem": "The document has no frontmatter block."
		}
	],
	"findings": [
		{
			"rule": "payments.no-floating-point-money",
			"level": "MUST",
			"title": "Monetary values do not use floating-point types",
			"description": "Floating-point rounding can produce incorrect payment amounts.",
			"path": "src/billing/invoice.ts",
			"lines": [41, 44],
			"evidence": "const total: number = subtotal * 1.2",
			"reason": "The invoice total is computed and stored as a floating-point number.",
			"suggestion": "Compute the total in minor units and wrap it in the Money value object.",
			"suggested_change": "const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);"
		}
	],
	"suppressed": [],
	"invalid_suppressions": []
}
```

- `version` is the report format version. This document specifies version 3.
  Version 3 reads rules from knowledge documents: each finding carries the
  rule's `title` and an optional `suggestion`, and the report records
  `sources` and `warnings`. The other version 2 fields keep their meanings.
- `cost`, `total_cost`, and `cost_basis` are defined above. A cost is a JSON
  number in United States dollars. The report MUST NOT hold a currency
  symbol or a locale-formatted value, so a consumer can add and compare
  costs. A text surface formats a cost with four decimal places, as
  `$0.0523`, and shows `$0.0000` rather than `$0` for a cost that rounds to
  zero.
- `sources` records the resolved commit of each Git knowledge source.
  `warnings` records the knowledge documents the loader skipped. Both are
  empty arrays when they have no entries.
- `lines` is a two-element array: the first and last line of the finding.
- `suggestion` is the evaluation agent's remediation advice, carried through
  verification. It appears only when the agent produced it.
- `suggested_change` is the exact replacement for `lines`. It appears only
  when evaluation proposed it and verification accepted it. It is always a
  non-empty string.
- `description` appears only when the rule's knowledge document defines one.
- `suppressed` lists suppressed findings: the finding fields above except
  `suggested_change`, plus the marker's `suppression_reason`. A suppressed
  finding has no suggested change because verification did not accept one.
  `invalid_suppressions` lists invalid markers with their `path`, `line`, and a
  `reason`. Both are defined in [Standards suppressions](./suppressions.md).

The JSON report MUST contain the same information as the text rendering.
Fields not listed here MUST NOT be added without a report format version
change.

A text rendering MUST show `suggested_change` under its finding with a
`Suggested change` label. It MUST preserve the replacement's line boundaries
and MUST NOT truncate the replacement.

## Provider failures

Agent invocations run against a remote provider and can fail. A review MUST
handle these failures without producing a wrong conclusion:

- For a transient failure — a rate limit, a server error, a network error,
  or agent output that does not match the required structure — the
  implementation MUST retry the invocation. Retries MUST be bounded, SHOULD
  back off between attempts, and SHOULD respect a retry delay that the
  provider names. A retry repeats one invocation; completed tasks are not
  repeated.
- For a non-transient failure — a rejected credential, an unknown model, an
  input that exceeds the model's context window, or exhausted retries — the
  review MUST fail as a whole, with a diagnostic that names the step, the
  provider, and the provider's error.
- A failed review reports no conclusion. A conclusion from a review that
  skipped part of the change would be wrong by omission, exactly like
  silent truncation. Partial results MAY be logged for diagnosis, but MUST
  NOT be reported as a review outcome.

## Token economy

These rules keep token use low across the pipeline:

- Selection, planning, deduplication, and report rendering MUST NOT use a
  model.
- Each hunk MUST reach exactly one evaluation task.
- Rule text sent to an agent MUST include only the fields the step uses.
- Agents read extra context on demand. The implementation MUST NOT preload
  file content beyond the hunks and their surrounding lines.
- Only structured findings flow between steps. Agent transcripts MUST NOT be
  forwarded to another agent.
- Suggested changes use the existing evaluation and verification invocations.
  The implementation MUST NOT add a model step only to produce them.
- Each agent step uses its selected model, resolved as defined in
  [Model selection](#model-selection). The default models balance review
  accuracy against token cost. A cheaper evaluation model with a stronger
  verification model is the split that saves tokens without losing trust in
  the confirmed findings.
- An empty selection ends the review with zero model invocations.

## Security considerations

- The change is untrusted input written by the change's author. Text
  inside the change is data, never an instruction. An agent MUST NOT follow
  instructions found in file content, and the verifier re-checks every finding
  with fresh context, which limits the effect of a manipulated evaluation.
- Rule text comes from the resolved knowledge sources; a Git source follows
  its branch, and the report records the resolved commits. The trust policy
  that decides whether review uses the base or head revision of
  `.standards.yml` stays excluded, as stated in
  [Standards configuration format](./configuration.md).
- An agent MUST NOT execute repository content, MUST NOT fetch URLs, and MUST
  NOT read outside the head checkout. A URL in a rule body is reported, not
  fetched.
- The implementation sends rule text and change content only to the selected
  provider. It MUST NOT call a provider that the selection did not name.
- Findings quote the change. An evidence quote MUST stay short and MUST NOT
  include more of the change than the violation needs.
- Suggested changes are model output. The review MUST NOT write them to the
  checkout, execute them, or claim that they passed repository checks. A user
  must inspect a suggested change before applying it.

## Version 2 exclusions

This version does not define:

- The `standards review` option surface, such as change scope and rule set
  selection. [Standards CLI](./cli.md) defines it.
- A triage step between selection and planning that discards rule and file
  pairs with a smaller model before evaluation.
- Result caching across runs, such as skipping hunks already reviewed at the
  same commit.
- Rules that need repository-wide context beyond the change and the head
  checkout reads described above.
- Autofix and patch output. A suggested change is report data; the review does
  not apply it to the repository.
- Per-repository exception lists. In-change suppressions are defined in
  [Standards suppressions](./suppressions.md).
- Incremental review of new commits on an already-reviewed pull request.
- Per-rule model selection. Models are selected per agent step, not per rule.
- Custom endpoints, proxies, or gateway configuration beyond what the
  provider SDK reads from its own environment variables.
- Budgets, spend limits, and token ceilings: a task size limit, a bound on
  agent reads, a cap on agent turns, or a per-run token ceiling. The
  report's usage counts and cost show what a review spent; version 2
  reports a cost, it does not cap one. A later version MAY add
  budgets as a new feature; a task that exceeds the model's context window
  fails the review as a provider failure until then.
