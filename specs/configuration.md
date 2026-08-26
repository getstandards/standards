# Standards configuration format

Defines Standards configuration format.

## Purpose

A Standards configuration names the knowledge sources whose documents an agent
can enforce during review of a change. A rule is a knowledge document in the
Open Knowledge Format (OKF): a markdown file with YAML frontmatter and a prose
body. The configuration maps knowledge folders to requirement levels.

This document specifies version 2 of the configuration format. It does not
specify how the review agent selects rules, evaluates a change, or reports a
result. [Standards review](./review.md) specifies these.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Entry file

The entry file MUST be named `.standards.yml` and MUST be at the repository
root. It MUST contain one YAML document.

A minimal configuration is:

```yaml
---
version: 2
```

## Example

```yaml
---
version: 2
name: payments-service
description: Standards for the payments service.

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

## Top-level fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | integer | Yes | Configuration format version. Version 2 requires the value `2`. |
| `name` | string | No | Human-readable name of this configuration. |
| `description` | string | No | Human-readable purpose and scope of this configuration. |
| `sources` | array of source objects | No | The knowledge sources to read rules from. The default is an empty array. |

Unknown top-level fields MUST cause validation to fail. A file that contains
only `version` is valid and resolves to an empty rule set.

## Knowledge sources

A source is a directory tree that holds an OKF bundle. OKF specifies the
document format, not folder names, so the configuration states which folders
hold rules. Each source MUST contain exactly one of `path` or `git`, and MUST
list one or more `rules` entries.

### Local source

```yaml
sources:
  - path: ./knowledge
    rules:
      - folder: decisions
        level: MUST
```

`path` MUST be a relative path to a directory. It is resolved from the
repository root. The resolved path MUST stay within the root of the repository
being reviewed, including after symbolic links are resolved. Absolute paths
and paths that escape the repository MUST cause resolution to fail.

### Git source

```yaml
sources:
  - git:
      repository: https://github.com/example/engineering-knowledge
      ref: main
      path: bundles/backend
    rules:
      - folder: decisions
        level: MUST
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `repository` | string | Yes | URL of the Git repository. |
| `ref` | string | No | Branch name without the `refs/heads/` prefix. When absent, the loader uses the repository's default branch. |
| `path` | string | No | Relative path to the bundle root in the repository. The default is the repository root. |

`repository` accepts two URL forms:

- HTTPS, for example `https://github.com/example/engineering-knowledge`.
  Credentials in the URL MUST be rejected. Authentication comes from the
  environment, for example the action's token.
- SSH, in `ssh://` or scp form, for example
  `git@github.com:example/engineering-knowledge.git`. Authentication comes
  from the user's SSH configuration. This form fits local CLI use against
  private repositories.

`path` MUST NOT escape the repository root.

### Freshness

Knowledge follows the branch. Standards does not pin sources. At the start of
a run, the loader MUST resolve each `ref` to its current commit with
`git ls-remote`, then fetch through the commit-keyed cache defined in
[Standards source cache](./cache.md). A review always judges the change
against the most recent accepted knowledge.

For traceability, the report and the check run record the resolved commit of
each Git source. The gate against a bad knowledge change is the knowledge
repository's own review process, not a pin.

### Folder mappings

Each `rules` entry maps one folder of the bundle to a requirement level:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `folder` | string | Yes | A bundle-relative directory, for example `decisions` or `guides/clickhouse`. |
| `level` | string | Yes | `MUST` (blocking) or `SHOULD` (advisory). |

Discovery is recursive: every markdown document under the folder is a rule, at
any depth. `index.md` files are navigation, not rules, and MUST be skipped at
every depth. A folder that is not listed is not read: enforcement is opt-in
per folder.

Two `rules` entries of the same source MUST NOT overlap: a folder that
contains another mapped folder is a configuration error. This keeps one
unambiguous level per document.

### Requirement levels

| Level | Meaning |
| --- | --- |
| `MUST` | Blocking. A confirmed finding makes the review non-compliant. |
| `SHOULD` | Advisory. A confirmed finding is reported and does not block. |

Polarity (required against prohibited) lives in the prose of the rule
statement. The pipeline only needs the blocking / advisory distinction.

## Knowledge document format

### Frontmatter fields that Standards reads

Standards does not control the bundles it reads, and OKF tooling validates
very little. The loader therefore defines a default for every absent field
and a safe behavior for every invalid one. A bad document MUST never break a
review.

| Field | Default when absent | Use |
| --- | --- | --- |
| `title` | The file name without `.md`. | The rule statement shown to the model and in reports. |
| `description` | Empty. | A one-line summary shown in reports. |
| `status` | `stable` (the OKF default), so the document is enforced. | Lifecycle filter. Only `stable` documents are enforced. |
| `adr_status` | No constraint. | Lifecycle filter. When present, only `accepted` is enforced. |
| `superseded_by` | None. | Identity alias chain (see Rule identity). |
| `applies_to` | Every file. | The `include`/`exclude` glob filter (see File applicability). |
| `type`, `tags` | Empty. | Informational. Not used for selection or level. |

All other OKF fields (`generated`, `verified`, `stale_after`, `sources`) and
unknown fields MUST be accepted and ignored.

`applies_to` is not an OKF field. Standards defines it as an extension. OKF
tooling ignores unknown frontmatter keys, so the field is additive and safe.
Bundle authors add it to the documents that need a narrower scope.

`superseded_by` is a document path resolved relative to the directory of the
document that carries it, for example `2026-03-01-newer-decision.md`.

### Invalid documents

A field that is present but invalid is not defaulted. The loader MUST skip the
whole document and report a warning that names the document and the problem.
Warnings appear in the report and in the check run, so the bundle gets fixed.
Cases:

- no frontmatter block, or frontmatter that is not valid YAML,
- a frontmatter value with a wrong type (for example `title` as a list),
- an unknown `status` or `adr_status` value,
- a malformed `applies_to` (wrong shape or invalid glob),
- a `superseded_by` chain that points to a missing document or forms a cycle,
- a derived `id` that does not match the id grammar.

A skipped document MUST NOT fail the run. Sources follow a branch, so a single
bad commit in a shared bundle must not block every review that consumes it.
Silence is the failure mode to avoid, not the run.

Configuration mistakes are different: the consumer authors `.standards.yml`,
so a mapped `folder` that does not exist in the bundle, or an unreachable
source, is an error that MUST fail the run.

### Body

The body is the rationale. Standards sends the full markdown body to the model
with the rule statement. Standards does not parse body sections. A URL in the
body is reported, not fetched.

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
changes.

A derived `id` MUST match this regular expression:

```text
^[a-z0-9]+(?:[._-][a-z0-9]+)*$
```

This is the version 1 rule `id` grammar, so suppression markers and finding
fingerprints keep their existing shape. A document whose derived id does not
match the grammar is skipped with a warning.

Each resolved rule ID MUST be unique. Two documents can derive the same `id`
from different mapped folders or different sources; a duplicate identity MUST
cause resolution to fail.

Standards expects bundles to supersede enforced documents instead of editing
them, so the identity is stable in practice. A content change creates a new
document and a new identity.

When the loader meets a document with `superseded_by`, it MUST follow the
chain to the newest document and enforce only that one. The derived ids of the
superseded documents become aliases of the final rule. A suppression marker
that names an alias suppresses the final rule.

## Lifecycle

The loader enforces a document only when:

- `status` is `stable`, and
- `adr_status`, when present, is `accepted`.

The loader skips `draft` documents. The loader skips `deprecated` documents,
except to follow their `superseded_by` chain. These lifecycle skips are not
warnings.

## File applicability

`applies_to` has this shape:

```yaml
applies_to:
  include:
    - src/**/*.ts
  exclude:
    - src/generated/**
    - src/**/*.test.ts
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `include` | non-empty array of strings | No | Globs that select paths. The default is `**/*`. |
| `exclude` | non-empty array of strings | No | Globs that remove paths selected by `include`. The default is an empty array. |

Paths are repository-relative and use `/` as the separator on all operating
systems. A path applies to a rule when it matches at least one `include` glob
and no `exclude` glob. Exclusion takes precedence over inclusion.

Globs use these constructs:

| Construct | Meaning |
| --- | --- |
| `*` | Zero or more characters other than `/`. |
| `?` | One character other than `/`. |
| `**` | Zero or more complete path segments. |
| `[abc]` | One character in the set. |
| `[a-z]` | One character in the range. |
| `{ts,tsx}` | One of the comma-separated alternatives. |

Globs MUST NOT depend on the host operating system. Matching is case-sensitive.
Paths MUST NOT start with `/`, contain `.` or `..` path segments, or contain a
backslash. In a document, invalid or unsupported glob syntax makes the
document invalid (see Invalid documents).

File applicability is an initial filter, not proof that a rule is relevant or
compliant. The review agent can discard a selected rule after it examines the
change and its context.

## Resolution

An implementation MUST resolve a configuration as follows:

1. Load and validate the entry file.
2. Resolve each source in list order. For a Git source, resolve the `ref` to
   its current commit and fetch that commit through the cache.
3. For each folder mapping, discover the markdown documents under the folder,
   recursively, skipping `index.md`.
4. Parse each document's frontmatter. Skip an invalid document with a
   warning. Skip documents that the lifecycle filters exclude.
5. Follow `superseded_by` chains and attach the superseded ids as aliases of
   each chain's final rule.
6. Derive rule ids and reject duplicates across all sources.

The result is one ordered list of rules and one list of warnings. Rule order
is stable input for review and reporting, but it does not change rule priority
or requirement level.

Failure to reach, fetch, or validate a source, or a mapped folder that does
not exist in its bundle, MUST fail the complete configuration. An invalid
document MUST NOT.

The implementation SHOULD cache Git sources by resolved commit, as specified
in [Standards source cache](./cache.md). Cached content MUST be verified
against the requested commit object ID before use.

## Validation and diagnostics

Configuration processing has two phases:

1. Validation checks the YAML structure and values of the entry file.
2. Resolution loads the sources and their documents and checks constraints
   that apply to the complete rule set, such as unique ids.

Diagnostics SHOULD contain:

- The source directory or Git repository, requested `ref`, and resolved
  commit.
- The YAML path of the invalid value, such as `sources[0].rules[1].folder`.
- A concise reason and, when possible, the allowed values.

YAML aliases and anchors MAY be accepted within one file. They MUST NOT change
the validation rules. Duplicate mapping keys MUST cause validation to fail.

OKF is the format authority for rule documents. Standards publishes no JSON
Schema; the internal configuration schema and the frontmatter validation
rules in this document are the reference.

## Versioning

`version` identifies the configuration syntax, not the application version.
An implementation MUST reject unsupported versions, including version 1.
Version 1 configurations carried a `rules` list and an `extends` list; both
are removed, together with the `.standards.lock` file.

## Version 2 exclusions

Version 2 does not define:

- Enforcement opt-out per document inside an enforced folder.
- Rule overrides or repository-specific exceptions.
- Variables, templates, or parameterized rule sets.
- Conditional rules based on branches, labels, authors, or pull request
  metadata.
- Inline scripts, commands, prompts, or executable checks.
- Pinning a source to a commit or tag.
- The trust policy that decides whether review uses the base or head revision
  of `.standards.yml`.
