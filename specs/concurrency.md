# Standards review concurrency

Defines the concurrency limit that bounds the parallel agent invocations of a
review.

## Purpose

The evaluation step runs one agent invocation per task, and the verification
step runs one agent invocation per finding. The invocations of a step are
independent, so [Standards review](./review.md) lets them run concurrently.
Concurrency keeps a review fast: an invocation waits on a remote provider,
not on local work.

Without a bound, a large change starts every invocation at once. A review of
fifty changed files opens fifty provider requests at the same time. This
triggers provider rate limits, spends the bounded retries of many invocations
at once, and can fail a review that a slower schedule would complete. The
concurrency limit caps the count of invocations that run at the same time.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the concurrency limit: its value rules, its default,
where it applies, its failure behavior, and how each surface sets it. It does
not change the pipeline steps, the report format, or the retry rules of
[Standards review](./review.md).

## The concurrency limit

The concurrency limit is one integer for the whole review:

- The value MUST be an integer greater than or equal to `1`.
- The default is `4`.
- A limit of `1` runs the invocations of each step one after another.

One value covers both agent steps. The steps run one after the other, so a
review never has more in-flight invocations than the limit.

## Where the limit applies

The limit applies to the agent invocations of the evaluation step and the
verification step:

- A step MUST NOT have more in-flight agent invocations than the limit.
- A step MUST start a waiting invocation when a running invocation completes,
  until no invocation waits.
- An invocation keeps its slot through its bounded retries, defined in
  [Standards review](./review.md). A retry is not a new invocation.

The limit schedules work; it MUST NOT change the result:

- Every planned invocation runs, whatever the limit. A finding never stops a
  step: findings are review output, not failures.
- The implementation MUST collect step results in plan order, not in
  completion order, so the limit does not reorder the report.
- Progress callbacks report finished invocations as they complete, as
  [Standards review](./review.md) defines.

The limit does not apply to the steps without a model: selection, planning,
deduplication, and report rendering stay local deterministic work.

## Failure behavior

[Standards review](./review.md) defines when an invocation fails and when the
review fails as a whole. The limit adds one scheduling rule:

- When an invocation fails after its bounded retries, the step MUST NOT start
  a waiting invocation.
- In-flight invocations MAY run to completion. Their results are discarded
  with the failed step: a failed review reports no conclusion.

This rule bounds the tokens that a failing review spends: at most the limit's
count of invocations is in flight when the failure surfaces.

## Selection precedence

The effective limit comes from the first source that is set:

1. The `--concurrency <n>` command option, or the equivalent input of another
   surface.
2. The `STANDARDS_CONCURRENCY` environment variable.
3. The `concurrency` field of the settings file, defined in
   [Standards settings](./settings.md).
4. The default, `4`.

A source that holds a value that is not an integer greater than or equal to
`1` MUST fail the command with a diagnostic that names the source and the
value. It MUST NOT fall through to the next source: a run that ignored the
value would use a different limit than the user set.

## Core library

`runReview` accepts the limit as an optional `concurrency` field of
`RunReviewInput`. An absent field means the default. A value that is not an
integer greater than or equal to `1` MUST surface as a thrown typed error,
never as a process exit status.

The scheduler that enforces the limit is an implementation detail of the
core. It MUST NOT be exported: [Standards core library](./library.md) keeps
the agent loop internal, and the scheduler belongs to it.

## Command line

`standards review --concurrency <n>` sets the limit for one invocation, with
the precedence above. An invalid value MUST print a diagnostic and exit with
status `2`. `standards test` accepts the same option for the reviews it runs.

The `--verbose` output SHOULD name the effective limit before the evaluation
step starts.

## GitHub Action

The action accepts a `concurrency` input and forwards it to the review as the
`STANDARDS_CONCURRENCY` environment variable. The action stays a thin
surface, as [Standards GitHub action](./github.md) defines: it MUST NOT add
its own precedence rules.

## Version 1 exclusions

This version does not define:

- Separate limits for the evaluation step and the verification step.
- An adaptive limit that reads provider rate-limit responses.
- A limit shared across concurrent review processes.
- Overlap between the steps: verification starts only after evaluation
  completes.
