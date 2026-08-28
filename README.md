<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/standards-wordmark-dark.gif">
    <source media="(prefers-color-scheme: light)" srcset="assets/standards-wordmark-light.gif">
    <img alt="Standards" width="300" src="assets/standards-wordmark-light.gif">
  </picture>
</p>

<p align="center">
  <strong>Record an engineering decision once, by hand or with an AI. Standards enforces it on every change after that.</strong><br>
  Rules are plain markdown knowledge documents. Standards catches the judgement calls that no linter can express, and backs every finding with evidence and line numbers.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/getstandards/standards/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/getstandards/standards?style=social"></a>
</p>

<!-- Add a screenshot of the pull request comment here. It is the best demo of what Standards does. -->

## From decision to enforced rule

Your team takes a decision: an architecture choice, an API convention, a lesson from an incident. You or your coding agent record it as a markdown file with YAML frontmatter. Every frontmatter field is optional: the title defaults to the file name, and unknown fields are ignored. Standards reads the files as Open Knowledge Format (OKF) documents, so bundles written for other OKF tools work unchanged.

From that moment, every review judges each change against it. Rules live in knowledge folders and change through pull requests, like code. An ADR under `decisions/` and a convention under `practices/` work the same way. `.standards.yml` maps each folder to a requirement level: `MUST` blocks the merge, `SHOULD` warns.

```yaml
version: 2
sources:
  - path: knowledge
    folders:
      decisions: MUST
      practices:
        level: SHOULD
        applies_to:
          include:
            - src/api/**/*.ts
```

A document like `knowledge/practices/api/paginate-unbounded-collections.md`:

```markdown
---
title: An endpoint that returns an unbounded collection accepts pagination parameters
description: Unbounded responses degrade as the data grows.
---

Unbounded responses degrade as the data grows, until the endpoint times out.
Accept limit and cursor parameters and cap the page size.
```

No linter can check that rule. An agent can.

## Findings come with evidence

A review of a change that adds an unpaginated endpoint and computes a refund with floating-point arithmetic. `--verbose` shows every step of the pipeline:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/standards-review-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/standards-review-light.svg">
    <img alt="Output of standards review: a non-compliant report with two findings, each with evidence, a reason, and a suggestion" width="880" src="assets/standards-review-light.svg">
  </picture>
</p>

Deterministic planning selects the files and the rules the model sees. A separate verification pass re-checks every finding before it is reported. The report shows the models used and the exact token cost of the review.

## Quick start

**1. Install the CLI:**

```bash
npm install --global @getstandards/standards
```

**2. Add your rules.** Run `standards init`, write your rules as knowledge documents, and map their folders in `.standards.yml`.

**3. Connect a model provider.** With Anthropic:

```bash
standards auth login anthropic
```

Or with OpenRouter:

```bash
standards auth login openrouter
```

OpenRouter also needs a model. Save one in `~/.config/standards/settings.yml`:

```yaml
# ~/.config/standards/settings.yml
version: 1
model: openrouter/anthropic/claude-sonnet-5
```

See [provider credentials](specs/credentials.md) for environment variables and other providers.

**4. Review a change locally:**

```bash
standards review
```

The review compares your working tree, uncommitted changes included, against the merge base with the default branch. Use `--staged` for the staged changes, `--range main..HEAD` for a commit range, or `--all` for a full audit.

While you write a rule, check one file against that rule only:

```bash
standards review --all src/api/orders.ts --rule api.paginate-unbounded-collections
```

**5. Enforce the rules on every pull request:**

```yaml
# .github/workflows/standards.yml
name: Standards
on: [pull_request]

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

The Action runs the same pipeline as the CLI and posts the report as a check run and a pull request comment. See the [GitHub Action specification](specs/github.md) to use another provider.

**6. Review from your coding agent.** Inside [pi](https://github.com/earendil-works/pi):

```bash
pi install npm:@getstandards/pi
```

Then run `/standards` in a session. The review uses the model and the credentials pi already resolved, so it needs no separate login, and the findings go to the agent that can fix them. See the [pi extension specification](specs/pi.md).

## Why Standards?

Engineering rules live in wikis, RFCs, and one reviewer's head. They surface after the incident, when someone says *we knew about this*. Standards moves them somewhere enforceable:

- **Not a linter.** Linters match patterns. Standards rules describe when a technique applies and which trade-off to prefer. An agent applies them the way a reviewer does.
- **Not a generic AI reviewer.** No borrowed opinions. The agent enforces *your* rules: written by your team, versioned in Git, scoped by globs, reported with evidence you can audit.
- **Written by people or by agents.** A coding agent can record the decision it just applied as a knowledge document, in the same pull request as the code. The next review enforces it.
- **Shareable.** A source pulls a knowledge bundle from another repository and follows its branch, so every review judges the change against the most recent accepted knowledge. The report records the resolved commit of each source.
- **Token-frugal.** Deterministic planning selects what the model sees; the agent only does the work that needs judgement.
- **Your provider, your model.** You choose the provider and the model for each step of the review.

## Documentation

The full specification lives in [`specs/`](specs/):

- [Configuration](specs/configuration.md): knowledge sources, folder mappings, and the document format
- [Review pipeline](specs/review.md): how a review runs, and how it keeps token use low
- [CLI](specs/cli.md): `init`, `validate`, `review`, and the other commands
- [GitHub Action](specs/github.md): check runs, pull request comments, and permissions
- [pi extension](specs/pi.md): `/standards` inside the pi coding agent
- [Core library](specs/library.md): the packages and the surface every host builds on
- [Suppressions](specs/suppressions.md): how to waive a finding in code
- [Rule tests](specs/testing.md): how to test a rule before you enforce it

## License

[MIT](LICENSE)

---

If Standards is useful to you, star the repository. It helps other teams find it.
