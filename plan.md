# Plan: token cost of a review

## Goals

1. Report what a review costs in money, not only in tokens. The report's
   usage counts already show the token spend; a user cannot read a bill from
   them.
2. Correct the token counts the report already shows. They exclude cached
   tokens today, so a review that uses prompt caching under-reports its
   input.

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
- `report-markdown.ts`: add a cost column to the usage table and a total row.
- `--format json`: the report above.
- Action outputs: add `total-cost`, beside `conclusion`, `blocking-count`,
  `warning-count`, and `report-file`, so a workflow can act on the spend.

A review costs a fraction of a cent to a few cents, so a text surface MUST
show enough digits to make a small review readable. It formats a cost as
`$0.0523`, with four decimal places, and shows `$0.0000` rather than `$0` for
a cost that rounds to zero. A cost of exactly zero prints `$0.0000` as well;
the note below covers the case where that number means nothing.

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
- `specs/github.md`: add the `total-cost` action output.
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
- `action-run.test.ts`: the `total-cost` output is set.
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
