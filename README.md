<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/standards-wordmark-dark.gif">
    <source media="(prefers-color-scheme: light)" srcset="assets/standards-wordmark-light.gif">
    <img alt="Standards" src="assets/standards-wordmark-light.gif">
  </picture>
</p>

<p align="center">
  <strong>Write your engineering rules in YAML. An agent enforces them on every pull request.</strong><br>
  Standards catches the judgement calls that linters miss, and reports every finding with evidence and line numbers.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/nlecoy/standards/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/nlecoy/standards?style=social"></a>
</p>

<!-- Add a screenshot of the pull request comment here. It is the best demo of what Standards does. -->

## Rules look like this

```yaml
version: 1
name: engineering-standards

rules:
  - id: money.no-floating-point
    level: MUST NOT
    description: Monetary values must not use floating-point types.
    rationale: Floating-point rounding can produce incorrect amounts.
    applies_to:
      include:
        - src/**/*.{ts,tsx}
    guidance: Use the Money value object, or an integer in the smallest currency unit.

  - id: clickhouse.double-delta-for-slowly-changing-metrics
    level: SHOULD
    description: A numeric column whose value changes slowly between adjacent rows uses the DoubleDelta codec.
    rationale: Delta-based codecs cut storage and scan time on append-mostly metric tables.
    applies_to:
      include:
        - db/migrations/**/*.sql
    guidance: Add CODEC(DoubleDelta) to the column definition.
```

A rule states intent, not a pattern. That is what makes it enforceable by an agent when no linter can express it.

## A review looks like this

A real run against a migration that adds a `Nullable` column and a TTL clause:

```text
$ standards review --base HEAD~1 schemas/ --verbose
› Base revision: 40c7741950173b8344ab825f49dcb50b7fa02d07
› Head revision: 95751e9e27dd86eecdc08fdff2bf6dc3180eb09e
› Targets: schemas
› Selected schemas/20250918000001_initial.up.sql (modified): clickhouse.ttl-only-drop-parts, clickhouse.nullable-columns
› Evaluation task 1/1: schemas/20250918000001_initial.up.sql (rules: clickhouse.ttl-only-drop-parts, clickhouse.nullable-columns)
Evaluating 1 selected file in 1 evaluation task.
› Evaluating task 1/1: schemas/20250918000001_initial.up.sql.
› Verifying finding 1/2: clickhouse.ttl-only-drop-parts at schemas/20250918000001_initial.up.sql:28-28.
› Verifying finding 2/2: clickhouse.nullable-columns at schemas/20250918000001_initial.up.sql:23-23.
✘ Standards review: non-compliant

  Evaluation model:    opencode-go/deepseek-v4-flash
  Verification model:  opencode-go/deepseek-v4-flash
  Resolved rules:      2
  Selected rules:      2
  Evaluation tasks:    1
  Findings:            MUST: 1, SHOULD NOT: 1
  Evaluation usage:    1 invocations, 2066 input tokens, 1305 output tokens
  Verification usage:  2 invocations, 3237 input tokens, 737 output tokens

Findings

  ⚠ schemas/20250918000001_initial.up.sql:23  clickhouse.nullable-columns (SHOULD NOT)
    Evidence:   hello Nullable(String)
    Reason:     The change adds a Nullable(String) column, which creates an extra UInt8 column and negatively affects storage and performance.
    References: https://clickhouse.com/docs/concepts/best-practices/avoidnullablecolumns

  ✘ schemas/20250918000001_initial.up.sql:28  clickhouse.ttl-only-drop-parts (MUST)
    Evidence:   TTL timestamp + INTERVAL 180 DAY DELETE;
    Reason:     The table uses a ClickHouse TTL clause but does not set ttl_only_drop_part = 1 in a SETTINGS clause, so expired parts are rewritten instead of dropped.
```

A separate verification pass re-checks every finding before it is reported. The report includes the models used and the token cost of the review.

## Quick start

**1. Install the CLI:**

```bash
npm install --global @getstandards/standards
# or
brew install getstandards/tap/standards
```

**2. Add your rules.** Run `standards init` in your repository, then edit `.standards.yml` with the rules your team already agrees on, like the ones above.

**3. Review a change locally:**

```bash
standards review
```

**4. Enforce the rules on every pull request** with the GitHub Action:

```yaml
# .github/workflows/standards.yml
name: Standards
on: [pull_request]

permissions:
  contents: read
  checks: write
  pull-requests: write

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

**5. Open a pull request.** The review runs against the change and posts its findings as a check run and a summary comment. The CLI and the Action run the same review pipeline and produce the same report.

## Features

- **Rules as code.** Each rule has an id, an RFC 2119 level (`MUST`, `SHOULD`, …), a description, a rationale, and file globs. Rules change through pull requests, like any other code.
- **Share rule packs.** `extends` pulls rules from other repositories, so one team can publish standards and every service can adopt them. A lock file pins every revision, so reviews are reproducible.
- **Built for judgement calls.** "A numeric column whose value changes slowly between adjacent rows should use `DoubleDelta`" is about intent, not pattern matching. An agent applies it; deterministic code does everything else.
- **Token-frugal.** Deterministic planning selects what the model sees. One agent evaluates each task, and a separate verification step re-checks every finding before it is reported.
- **Your provider, your model.** You choose the provider and the model for each step of the review.
- **Terminal and GitHub.** The same report renders as CLI output, a check run, and a pull request comment.

## Why Standards?

Rules live in the wrong places — a wiki nobody opens, the head of the one person who reviews every schema change, an RFC that half the repos never adopted. They surface after the incident, when someone says *we knew about this.*

Most of them can't be caught by a linter either. "A numeric column whose value changes slowly between adjacent rows should use `DoubleDelta`" is a judgement call about intent, not a pattern match. That's the gap this fills: standards written precisely enough for a reviewing agent to apply, and auditable enough for a human to trust the result.

## Why not a linter, or a generic AI reviewer?

- **Linters match patterns.** Many engineering rules state intent: when a technique applies, which trade-off to prefer, what a change must respect. No AST rule expresses that. Standards rules are written for an agent that reads code the way a reviewer does.
- **Generic AI reviewers guess what matters.** They apply the same opinion to every repository. Standards enforces *your* rules: written by your team, versioned in Git, scoped by globs, and reported with evidence you can audit.

## Documentation

The `specs/` directory contains the full specification:

- [Configuration format](specs/configuration.md) — rules, `extends`, and the lock file
- [Review pipeline](specs/review.md) — how a review runs, and how it keeps token use low
- [CLI](specs/cli.md) — `init`, `validate`, `review`, and the other commands
- [GitHub Action](specs/github.md) — check runs, pull request comments, and permissions
- [Suppressions](specs/suppressions.md) — how to waive a finding in code
- [Rule tests](specs/testing.md) — how to test a rule before you enforce it

## License

[MIT](LICENSE)

---

If Standards is useful to you, star the repository. It helps other teams find it.
