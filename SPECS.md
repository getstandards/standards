# Specification: rules from OKF knowledge documents

Status: draft.

This document specifies the migration of Standards from `.standards.yml` rule
documents to knowledge documents in the Open Knowledge Format (OKF).

## Goal

Standards reads rules from markdown documents with YAML frontmatter instead of
a YAML rule list. A rule is an OKF knowledge document. The configuration maps
knowledge folders to requirement levels. The review pipeline keeps its current
logic. It detects which rules apply to a change, evaluates the change against
them, and reports findings.

## Background

Today, rules live in `.standards.yml`. Each rule is a flat object: `id`,
`level`, `description`, `rationale`, `applies_to`, `guidance`, `references`.
The resolver walks `extends` sources, and `loadRules` returns a flat rule set.

An OKF document has YAML frontmatter (`type`, `title`, `description`, `tags`,
`status`, and optional provenance fields) and a prose body. OKF specifies the
document format. OKF does not specify folder names. Two bundles can organize
the same knowledge under different directory structures. The configuration
must therefore state which folders hold rules.

## Configuration

`.standards.yml` stays the entry file. It stops carrying rules. It declares
knowledge sources and maps their folders to levels:

```yaml
version: 2
sources:
  - path: ./knowledge
    rules:
      - folder: decisions
        level: MUST
      - folder: practices
        level: SHOULD
  - git:
      repository: https://github.com/example/engineering-knowledge
      ref: main
    rules:
      - folder: decisions
        level: MUST
```

A source is:

- a local directory that contains an OKF bundle, or
- a Git repository (`repository`, optional `ref`, optional `path`) that
  contains an OKF bundle. `ref` is a branch name. When absent, the loader
  uses the repository's default branch.

Each source lists one or more `rules` entries. A `folder` is a bundle-relative
directory. Discovery is recursive: every markdown document under the folder is
a rule, at any depth. A bundle can nest documents freely, for example
`guides/llm/`, `guides/clickhouse/`, `guides/tidb/schema-design.md`. `index.md`
files are navigation, not rules, and are skipped at every depth. A folder that
is not listed is not read. Enforcement is opt-in per folder.

A `folder` can be a nested directory, for example `guides/clickhouse`. Two
`rules` entries of the same source must not overlap: a folder that contains
another mapped folder is a configuration error. This keeps one unambiguous
level per document.

The syntax change is breaking, so the document `version` becomes `2`.

### Freshness

Knowledge follows the branch. Standards does not pin sources. At the start of
a run, the loader resolves each `ref` to its current commit with
`git ls-remote`, then fetches through the existing commit-keyed cache. A
review always judges the change against the most recent accepted knowledge.

`.standards.lock` is removed. The pin existed for reproducible rule sets, but
a review is model-judged and is not reproducible in that sense. For
traceability, the report and the check run record the resolved commit of each
Git source. The gate against a bad knowledge change is the knowledge
repository's own review process, not a pin.

`repository` accepts two URL forms:

- HTTPS, for example `https://github.com/example/engineering-knowledge`.
  Credentials in the URL are rejected. Authentication comes from the
  environment, for example the action's token.
- SSH, in `ssh://` or scp form, for example
  `git@github.com:example/engineering-knowledge.git`. Authentication comes
  from the user's SSH configuration. This form fits local CLI use against
  private repositories.

## Knowledge document format

### Frontmatter fields that Standards reads

Standards does not control the bundles it reads, and OKF tooling validates
very little. The loader therefore defines a default for every absent field
and a safe behavior for every invalid one. A bad document must never break a
review.

| Field | Default when absent | Use |
| --- | --- | --- |
| `title` | The file name slug. | The rule statement shown to the model and in reports. |
| `description` | Empty. | A one-line summary shown in reports. |
| `status` | `stable` (the OKF default), so the document is enforced. | Lifecycle filter. Only `stable` documents are enforced. |
| `adr_status` | No constraint. | Lifecycle filter. When present, only `accepted` is enforced. |
| `superseded_by` | None. | Identity alias chain (see Rule identity). |
| `applies_to` | Every file. | The `include`/`exclude` glob filter, same shape and grammar as today. |
| `type`, `tags` | Empty. | Reported, not used for selection or level. |

All other OKF fields (`generated`, `verified`, `stale_after`, `sources`) and
unknown fields are accepted and ignored.

`applies_to` is not an OKF field. Standards defines it as an extension.
OKF tooling ignores unknown frontmatter keys, so the field is additive and
safe. Bundle authors add it to the documents that need a narrower scope.

### Invalid documents

A field that is present but invalid is not defaulted. The loader skips the
whole document and reports a warning that names the document and the problem.
Warnings appear in the report and in the check run, so the bundle gets fixed.
Cases:

- no frontmatter block, or frontmatter that is not valid YAML,
- a frontmatter value with a wrong type (for example `title` as a list),
- an unknown `status` or `adr_status` value,
- a malformed `applies_to` (wrong shape or invalid glob),
- a `superseded_by` chain that points to a missing document or forms a cycle,
- a derived `id` that does not match the id grammar.

A skipped document never fails the run. Sources follow a branch, so a single
bad commit in a shared bundle must not block every review that consumes it.
Silence is the failure mode to avoid, not the run.

Configuration mistakes are different: the consumer authors `.standards.yml`,
so a mapped `folder` that does not exist in the bundle, or an unreachable
source, is an error that fails the run, as today.

### Body

The body is the rationale. Standards sends the full markdown body to the model
with the rule statement. Standards does not parse body sections.

## Rule identity

The rule `id` derives from the document path relative to its mapped folder:
remove the `.md` extension and replace `/` with `.`. Examples, with
`folder: guides` and `folder: decisions` mapped:

- `guides/llm/prompt-caching.md` → `llm.prompt-caching`
- `guides/tidb/schema-design.md` → `tidb.schema-design`
- `decisions/2026-08-25-llm-calls-use-llm-service.md` →
  `2026-08-25-llm-calls-use-llm-service`

The mapped folder is not part of the `id`. A bundle can rename its top-level
folders without a change of rule identities; only the configuration mapping
changes. Derived ids keep the version 1 rule `id` grammar
(`^[a-z0-9]+(?:[._-][a-z0-9]+)*$`), so suppression markers and finding
fingerprints keep their existing shape. A document whose derived id does not
match the grammar is skipped with a warning (see Invalid documents).

Two documents can derive the same `id` from different mapped folders. The
existing duplicate-identity error catches this.

Standards expects bundles to supersede enforced documents instead of editing
them, so the identity is stable in practice. A content change creates a new
document and a new identity.

When the loader meets a document with `superseded_by`, it follows the chain to
the newest document and enforces only that one. The derived ids of the
superseded documents become aliases of the final rule. A suppression marker that names an
alias suppresses the final rule.

Duplicate identities across sources are an error, as today.

## Requirement levels

The configuration sets the level per folder. Two values exist:

- `MUST` → blocking. Equivalent to `MUST` / `MUST NOT`.
- `SHOULD` → advisory. Equivalent to `SHOULD` / `SHOULD NOT`.

Polarity (required against prohibited) lives in the prose of the rule
statement. The pipeline only needs the blocking / advisory distinction, which
is what reporting uses today. The `MAY` level disappears; the pipeline already
discards `MAY` rules before evaluation, so no behavior is lost.

## Lifecycle

The loader enforces a document only when:

- `status` is `stable`, and
- `adr_status`, when present, is `accepted`.

The loader skips `draft` documents. The loader skips `deprecated` documents,
except to follow their `superseded_by` chain.

## Rule selection

Selection keeps the current logic. `applies_to` compiles to the same
include/exclude glob matcher, with the same defaults: include `**/*`, exclude
nothing, exclusion wins.

## Prompt rendering

The evaluation and verification prompts render one rule as:

- the rule identity,
- the level,
- the rule statement (`title`) and `description`,
- the full markdown body.

`references` URLs in the body are reported, not fetched, as today.

## Guidance

The `guidance` rule field is removed. The model produces remediation advice
per finding instead. The evaluation output schema gains an optional
`suggestion` field on each finding. Verification carries it through. The
report renders it where the authored `guidance` rendered before. Advice
becomes specific to the change instead of generic per rule.

`rationale` as a field is removed. The body replaces it.

## Removals

- The `rules` list and the rule schema in `.standards.yml`.
- The `.standards.lock` file, the `standards lock` command, and the lockfile
  modules (schema, loader, updater).
- The published JSON Schemas in `schemas/v1/`, their generation script, the
  schema drift tests, and the `standards schema` command. OKF is the format
  authority for rule documents. A small internal schema remains for the
  configuration and for frontmatter validation errors.
- The `standards init` rule prompt. `init` writes a minimal source
  configuration instead.

## Change surface

In `packages/standards`:

- The configuration schema becomes sources with folder-to-level mappings
  (`version: 2`).
- New loader beside `config/` that walks the mapped folders and parses
  frontmatter documents into rules.
- `formatRule` in the evaluation and verification steps sends the body.
- The evaluation tool schema gains `suggestion`; the report reads it from the
  finding instead of the rule.
- The report and the check run gain the resolved commit of each Git source
  and the warnings for skipped documents.
- Removal of the schema tooling listed above.
- Spec updates: `specs/configuration.md` (rewrite), `specs/cli.md`,
  `specs/suppressions.md`, `specs/testing.md`, and `TERMINOLOGY.md`.

On the knowledge side, a bundle needs no change to become a source. Bundle
authors add `applies_to` only to the documents that need a narrower scope
than every file.

The review pipeline (`selectRules`, `planEvaluationTasks`, evaluation,
verification, report structure) and the source cache do not change.

## Open points

1. **Enforcement opt-out per document.** Folder mapping makes enforcement
   opt-in per folder, which removes most noise. Inside an enforced folder,
   some documents can still be knowledge-only and not code-checkable.
   Proposed escape hatch: an `enforcement: none` frontmatter field (or a
   reserved tag) that excludes one document. Not decided.
2. **In-place edits.** OKF does not forbid editing a document in place, so a
   rule's content can change under a stable identity. Standards accepts this
   for advisory folders; noted as a known limit.
3. **Rule statement field.** Document titles are descriptive, not always
   directive. Start with `title` plus body. Add an optional one-line `rule`
   frontmatter field later only if evaluation quality demands it.
