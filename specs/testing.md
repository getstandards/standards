# Standards rule tests

Defines rule tests and the `standards test` command.

## Purpose

A rule is a natural-language check that an agent runs. Nothing else in
Standards proves that a rule catches what it claims, or that it still
catches it after the rule text, a default model, or the pipeline changes. A
rule without tests rots silently: it looks enforced and is not.

A rule test states, with fixture content, what a rule must flag and what it
must leave alone. `standards test` runs those fixtures through the same
pipeline as a review and compares the outcome with the expectation. This
gives a rule repository the same safety net that a code repository gets from
its test suite.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Test files

A test file is named `*.standards-test.yml`. `standards test` MUST discover
every test file under the current working directory, excluding the `.git`
directory. Test files SHOULD live next to the knowledge documents that
define the rules they test.

A test file MUST contain one YAML document:

```yaml
---
version: 1
tests:
  - name: flags a float money computation
    rule: payments.no-floating-point-money
    verdict: violation
    lines: [2, 2]
    files:
      - path: src/billing/invoice.ts
        content: |
          export function total(subtotal: number): number {
            return subtotal * 1.2;
          }
  - name: accepts integer cents
    rule: payments.no-floating-point-money
    verdict: compliant
    files:
      - path: src/billing/invoice.ts
        content: |
          export function totalCents(subtotalCents: number): number {
            return Math.round(subtotalCents * 120) / 100;
          }
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | integer | Yes | Test format version. Version 1 requires the value `1`. |
| `tests` | array | Yes | The test cases in this file. |
| `tests[].name` | string | Yes | Human-readable test name, unique within the file. |
| `tests[].rule` | string | Yes | The `id` of the tested rule. It MUST exist in the resolved rule set. |
| `tests[].verdict` | string | Yes | Expected outcome: `violation` or `compliant`. |
| `tests[].lines` | array | No | For a `violation` test: a `[first, last]` range that the finding must overlap. |
| `tests[].files` | array | Yes | The fixture files: each entry has a `path` and its full `content`. |

Unknown fields MUST cause validation to fail. `lines` MUST NOT be used with
a `compliant` verdict.

## Execution

For each test case, the implementation MUST:

1. Build a synthetic change in which every fixture file is added in full, so
   every content line is a changed line.
2. Run the review pipeline defined in [Standards review](./review.md) with
   the rule set restricted to the tested rule.
3. Compare the confirmed findings with the expected verdict.

A test passes when:

- `verdict: violation` — at least one confirmed finding names the tested
  rule, and, when `lines` is given, at least one such finding overlaps the
  range.
- `verdict: compliant` — no confirmed finding names the tested rule.

When the tested rule's `applies_to` filter selects none of the fixture
files, the test MUST fail with a diagnostic that says so. A rule that never
selects its own fixtures is itself a bug worth catching.

Model selection, credentials, and provider failure handling are the same as
for a review, as defined in [Standards review](./review.md) and
[Standards provider credentials](./credentials.md). Rule tests spend real
model tokens; fixture files SHOULD stay as small as the behavior allows.

## Output

The command MUST report one line per test with its name, tested rule, and
result, and a summary with pass and fail counts and the model usage totals.
A failed test MUST show why: the findings that appeared for a `compliant`
verdict, or the absence or wrong location of findings for a `violation`
verdict.

`standards test` is a checking command, as defined in
[Standards CLI](./cli.md): status `0` when every test passes, status `1`
when at least one test fails, status `2` when the tests could not run or
complete.

## Determinism

A rule test is an integration test against a model, and a model is not
deterministic. A test that passes only sometimes is a signal about the rule,
not about the runner: the rule's statement and body are not testable enough
for an agent to apply consistently. The fix is to tighten the rule text, not
to retry the test.

## Version 1 exclusions

This version does not define:

- Selecting a subset of tests to run.
- Diff-shaped fixtures with a base and head version of a file.
- Recorded or mocked model responses.
- Repeated runs, pass-rate thresholds, or variance measurement.
- Per-test model selection.
- A machine-readable test report.
- Coverage reporting for rules without tests.
