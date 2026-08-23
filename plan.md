# Plan: token cost of a review

## Goals

1. Report what a review costs in money, not only in tokens. The report's
   usage counts already show the token spend; a user cannot read a bill from
   them.
2. Correct the token counts the report already shows. They exclude cached
   tokens today, so a review that uses prompt caching under-reports its
   input.
3. Show what a complete pull request cost, not only its last run. A pull
   request is reviewed many times: it opens, the review asks for changes, the
   author pushes a fix, and the review runs again. Each run spends tokens. The
   summary comment MUST show the sum.

## Cost data from the provider SDK

The pi AI SDK computes the cost of each request. Every API adapter calls
`calculateCost(model, usage)` before it returns the message, so
`message.usage.cost` is already complete when `review-agent.ts` receives it:

```
cost: { input, output, cacheRead, cacheWrite, total }
```

The rates come from `Model.cost`, in United States dollars per one million
tokens. The implementation MUST read this value. It MUST NOT compute a cost
from the rates itself, for three reasons:

- `Model.cost.tiers` holds request-wide pricing tiers. The highest matching
  `inputTokensAbove` threshold applies to the complete request. For example
  `openai/gpt-5.5` charges 5 and 30 below 272000 input tokens, and 10 and 45
  above.
- The tier threshold reads `input + cacheRead + cacheWrite` of **one**
  request. A cost computed from the summed tokens of a step would cross the
  threshold that no single request crossed, and would over-report.
- Anthropic charges twice the base input rate for a one-hour cache write. The
  SDK holds this rule in `cacheWrite1h`.

So the implementation MUST add the cost of each invocation as the invocation
finishes. This is the same place where `review-agent.ts` adds the tokens
today.

The SDK gives no default model per provider, and no rank or flag on a model.
`Provider` exposes `id`, `name`, `baseUrl`, `headers`, `auth`, `getModels()`,
`refreshModels()`, and `filterModels()`, and the catalog order is
alphabetical. `DEFAULT_PROVIDER_MODELS` stays a Standards constant.

## The token counts are wrong today

`calculateCost` treats `usage.input`, `usage.cacheRead`, and
`usage.cacheWrite` as three separate counts. `review-agent.ts` adds only
`usage.input`, so `input_tokens` in the report excludes every cached token.
With prompt caching this is a large under-count, and it makes the reported
tokens disagree with the reported cost.

`StepUsage` MUST therefore also carry the cache token counts:

- `input_tokens`: the uncached input tokens the provider reported.
- `cache_read_tokens`: the input tokens the provider served from its cache.
- `cache_write_tokens`: the input tokens the provider wrote to its cache.
- `output_tokens`: unchanged.
- `cost`: the cost of the step in United States dollars.

`AgentTokens` gains the same fields. It no longer holds only tokens, so it is
renamed to `AgentInvocationUsage` in the same change.

## Report shape

`usage` gains one `cost` field per step, and a `cost` total for the review:

```json
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
	"total_cost": 0.0523
}
```

The change is additive, so the report stays `version: 1`. A consumer that
reads only the current keys keeps working.

`cost` is a number, not a formatted string, so a consumer can add and compare
costs. The currency is always United States dollars, because the SDK rates
are. The report MUST NOT hold a currency symbol or a locale-formatted value.

## Surfaces

Every surface that shows usage today MUST also show the cost:

- `review-report-text.ts`: add the cost to each usage line and a review total.
  The plain text and the terminal rendering show the same value.
- `report-markdown.ts`: add a cost column to the usage table and a run total
  row. The summary comment also shows the pull request total, defined in the
  next section.
- `--format json`: the report above. The report stays the record of **one**
  run. A cumulative total belongs to a pull request, not to a review, so it
  MUST NOT enter the report shape.
- Action outputs: add `total-cost` for the run, and
  `pull-request-total-cost` for the sum across runs, beside `conclusion`,
  `blocking-count`, `warning-count`, and `report-file`. A workflow can then
  act on either spend.

A review costs a fraction of a cent to a few cents, so a text surface MUST
show enough digits to make a small review readable. It formats a cost as
`$0.0523`, with four decimal places, and shows `$0.0000` rather than `$0` for
a cost that rounds to zero. A cost of exactly zero prints `$0.0000` as well;
the note below covers the case where that number means nothing.

## Cumulative cost on one pull request

The summary comment is one comment per pull request, found by its
`<!-- standards:report:v1 -->` marker and updated in place
(specs/github.md summary comment). Every run replaces the body. A run cost
written there alone would therefore replace the cost of the run before it,
and the comment would answer "what did the last run cost?" instead of "what
did this pull request cost?".

The pull request has no other durable store. The check run of each run is a
new object, and the action keeps no state between runs. So the comment MUST
carry its own running total, and the action MUST read that total back before
it writes the new body.

### Reading the total back

`findSummaryCommentId` in `action-runner.ts` already reads every comment body
through `github.paginate`, and then keeps only the comment id. It MUST return
the body as well. The change is a rename to `findSummaryComment`, returning
the id and the body, because the return value changes.

The total lives in a second hidden marker, in the same style as the finding
fingerprint marker:

```text
<!-- standards:cost:v1 {"runs":3,"total_cost":0.1571} -->
```

The `standards:report:v1` marker MUST stay the comment's first line, because
`findSummaryComment` matches it with `startsWith`. The cost marker takes the
line after it.

The action MUST parse this marker from the comment it found, add the cost of
the current run, and write the new values back in the new body. A marker that
is absent, unparsable, or holds values of the wrong type MUST be treated as
absent. It MUST NOT fail the run: a review result is worth more than a cost
total.

### What the comment shows

The collapsed details block gains two lines: the cost of this run, and the
cost of the pull request with the number of runs it counts. For example:

```text
This run: $0.0523
This pull request: $0.1571 across 3 runs
```

When the run is the first counted run, the comment shows only the run cost.
One run is not a sum, and "across 1 run" reads as noise.

### Counting rules

- A re-run for the same head commit MUST add its cost. The re-run spent the
  tokens again. The total answers what the pull request cost, not what its
  distinct commits cost.
- A cancelled run MUST NOT add its cost. It never writes the comment, so its
  partial spend is lost. This under-reports, and that is the correct
  direction for a number a user may read as a bill.
- A force push or a rebase does not reset the total. The tokens were spent.
- A compliant run with no findings does not create the summary comment
  (specs/github.md). Its cost is lost when no comment exists yet. So a pull
  request whose **first** runs are all clean starts its count at the first run
  that creates the comment. The comment MUST say `across N runs`, naming the
  runs it counted, and MUST NOT claim to be the complete history.
- An existing comment from a release before this change holds no cost marker.
  The action MUST start the count at the current run and MUST NOT read the
  missing marker as a zero total. A zero would present an unknown history as a
  known one.

### Concurrency

Reading the total and writing the new body is a read-modify-write on one
comment through the GitHub API, which offers no compare-and-set. Two runs that
overlap can therefore lose one increment. The recommended workflow in
specs/github.md sets `concurrency` with `cancel-in-progress: true`, which
stops the overlap for the documented setup.

This is an accepted limitation, not a defect to design around: the cost of a
lock or a retry loop is higher than the cost of a rare lost increment in a
number that informs rather than gates. `specs/github.md` MUST state it.

## A subscription credential has no per-token price

`Model.cost` holds the API list price. A subscription credential, such as an
Anthropic OAuth credential for a Claude Pro or Max account, does not charge
per token. A local provider charges nothing at all. In both cases the
computed cost is an estimate of what the same tokens would have cost through
the API, and it is not a charge.

The report MUST NOT present an estimate as a charge. Two options, to decide
before implementation:

1. Add a `cost_basis` field to each step: `charged` for an API key
   credential, `list_price_estimate` for a subscription credential, and
   `none` for a provider whose model costs are all zero. A text surface adds
   a short note for a value other than `charged`.
2. Report the number with no qualifier, and state the limit in
   `specs/review.md` only.

Option 1 is the honest one and reuses the credential kind that
`standards auth status` already reads. It costs one field and one note.
Option 2 is smaller and risks a user reading a subscription review as a bill.
**Recommendation: option 1.**

## Documentation and terminology

- `specs/review.md`: the report section MUST require the cost of each step
  and the review total, and MUST state the currency, the source of the rates,
  and the per-invocation accumulation rule. The version 1 exclusion for
  budgets and spend limits stays: this change reports a cost, it does not cap
  one.
- `specs/github.md`: add the `total-cost` and `pull-request-total-cost`
  action outputs. The summary comment section MUST define the
  `standards:cost:v1` marker, require the running total, and state the
  counting rules and the concurrency limit above. The comment layout list
  MUST name the two cost lines in the details block.
- `TERMINOLOGY.md`: add **cost** (the model spend of a review in United
  States dollars, from the provider SDK rates) and **cache read tokens** and
  **cache write tokens** if the report names them.
- `README.md`: the feature list already claims the report includes "the token
  cost of the review". After this change that claim is true. Check the wording
  and keep it.

## Testing

- `agent-usage.test.ts`: adding one invocation's usage accumulates the tokens,
  the cache tokens, and the cost.
- A regression test for the tier rule: two invocations that each stay below a
  tier threshold, and whose summed input crosses it, MUST produce the sum of
  the two per-invocation costs, not the tiered cost of the sum.
- A regression test for the cached-token count: an invocation that reports
  `cacheRead` tokens MUST appear in `cache_read_tokens`, and MUST NOT be lost.
- `review-report.test.ts`: the report holds the per-step costs and the total.
- `review-report-text.test.ts` and `report-markdown.test.ts`: the cost appears
  in each rendering, with a small cost readable and a zero cost shown.
- `action-run.test.ts`: both the `total-cost` and the
  `pull-request-total-cost` outputs are set.
- The cumulative total, against a mocked Octokit:
  - A first run writes the cost marker and shows only the run cost.
  - A second run reads the marker, adds its cost, and shows
    `across 2 runs`.
  - An existing comment with no cost marker starts the count at this run and
    does not report the total as this run's cost alone.
  - An unparsable cost marker does not fail the run.
  - The rendered marker survives a round trip: the body one run writes parses
    back to the same values in the next run.
- A fake Models collection returns messages with a known `usage.cost`, so no
  test reaches a provider.

## Out of scope

- Budgets, spend limits, and token ceilings. `specs/review.md` excludes them
  from version 1 and this change does not add them.
- A cost or pricing column in `standards models`. That command arrives on the
  `auth` and `models` branch; add the column after both land, so the two
  changes do not touch the same new file.
- `DEFAULT_PROVIDER_MODELS.google` names `gemini-3.1-pro`, which the SDK
  catalog does not hold; the catalog has `gemini-3.1-pro-preview`. A review
  that falls back to the Google default therefore fails at request time
  instead of at selection time. This is a separate fix, and it wants a test
  that asserts every default model exists in its provider's catalog.
- Per-rule or per-file cost attribution. The report shows the cost per agent
  step.
