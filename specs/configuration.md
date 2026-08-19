# Standards configuration format

Defines Standards configuration format.

## Purpose

A Standards configuration defines the engineering rules that an agent can
evaluate during review of a change. A repository can define rules directly,
extend one or more local files, extend files from other Git repositories, or
combine these options.

This document specifies version 1 of the configuration format. It does not
specify how the review agent selects rules, evaluates a change, or reports a
result. [Standards review](./review.md) specifies these.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119. The same words are
also valid values for a rule's `level` field.

## Entry file

The entry file MUST be named `.standards.yml` and MUST be at the repository
root. It MUST contain one YAML document.

Every configuration file, including an extended file, MUST use the format in
this specification. A minimal configuration is:

```yaml
---
version: 1
```

## Example

```yaml
---
version: 1
name: payments-service
description: Standards for the payments service.

extends:
  - path: .standards/typescript.yml
  - git:
      repository: https://github.com/acme/engineering-standards.git
      revision:
        tag: v2.1.0
      path: rules/security.yml

rules:
  - id: payments.no-floating-point-money
    level: MUST NOT
    description: Monetary values must not use floating-point types.
    rationale: Floating-point rounding can produce incorrect payment amounts.
    applies_to:
      include:
        - src/**/*.{ts,tsx}
      exclude:
        - src/**/*.test.ts
    guidance: Use the Money value object or an integer in the smallest currency unit.
    references:
      - https://engineering.example.com/decisions/money-values
```

## Top-level fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | integer | Yes | Configuration format version. Version 1 requires the value `1`. |
| `name` | string | No | Human-readable name of this rule set. |
| `description` | string | No | Human-readable purpose and scope of this rule set. |
| `extends` | array of source objects | No | Other configuration files to load before this file. |
| `rules` | array of rule objects | No | Rules defined by this file. The default is an empty array. |

Unknown top-level fields MUST cause validation to fail. `extends` and `rules`
are independent and optional. A file that contains only `version` is valid and
resolves to an empty rule set.

## Extended files

`extends` is an ordered list. Each item MUST contain exactly one of `path` or
`git`.

### Local source

```yaml
extends:
  - path: .standards/backend.yml
  - path: .standards/security.yml
```

`path` MUST be a relative path. It is resolved from the directory that contains
the file with the `extends` declaration. The resolved path MUST stay within the
root of the repository being reviewed, including after symbolic links are
resolved. Absolute paths and paths that escape the repository MUST cause
resolution to fail.

Local files MAY extend other local or Git sources.

### Git source

```yaml
extends:
  - git:
      repository: https://github.com/acme/engineering-standards.git
      revision:
        tag: v2.1.0
      path: rules/base.yml
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `repository` | string | Yes | HTTPS URL of the Git repository. |
| `revision` | object | Yes | Commit, tag, or branch that identifies the Git revision to load. |
| `path` | string | Yes | Relative path to the configuration file in the resolved commit. |

`revision` MUST contain exactly one of `commit`, `tag`, or `branch`:

```yaml
revision:
  commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
```

```yaml
revision:
  tag: v2.1.0
```

```yaml
revision:
  branch: main
```

| Field | Type | Meaning |
| --- | --- | --- |
| `commit` | string | Full commit object ID. It is immutable and does not require a lock entry. |
| `tag` | string | Git tag name without the `refs/tags/` prefix. It MUST resolve through the lock file. |
| `branch` | string | Git branch name without the `refs/heads/` prefix. It MUST resolve through the lock file. |

Version 1 requires an HTTPS repository URL. Tags and branches are mutable in
Git, so they MUST NOT be used without the lock mechanism specified below. A
generic `latest` revision selector MUST NOT be accepted because Git does not
define what it identifies. A tag or branch whose exact name is `latest` is a
valid revision and follows the normal lock rules. The implementation MAY use
configured Git credentials, but credentials MUST NOT be stored in the
configuration or lock file.

The `path` value MUST be relative to the root of the referenced repository. It
MUST NOT escape that root. A file loaded from Git MAY extend paths in the same
Git repository and revision. It MAY also extend another Git source. A local
source referenced from a Git source MUST NOT resolve into the repository being
reviewed.

## Lock file

The lock file makes tag-based and branch-based Git sources reproducible. It
MUST be named `.standards.lock` and MUST be at the root of the repository
being reviewed. It MUST be committed to the repository when the configuration
uses a tag or branch revision.

An entry file that directly or indirectly uses a tag or branch revision MUST
have a lock file. A configuration that uses only commit revisions does not
require one.

Example:

```yaml
---
version: 1
sources:
  - repository: https://github.com/acme/engineering-standards.git
    revision:
      tag: v2.1.0
    commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
```

### Lock file fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | integer | Yes | Lock format version. Version 1 requires the value `1`. |
| `sources` | array of source locks | Yes | Resolved tag and branch revisions. |

Each source lock has these fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `repository` | string | Yes | Exact HTTPS repository URL from the Git source. |
| `revision` | object | Yes | Exact `tag` or `branch` object from the Git source. |
| `commit` | string | Yes | Full commit object ID to which the revision resolved during the lock update. |

The lock entry's `revision` MUST contain exactly one of `tag` or `branch`.
`commit` MUST NOT be used inside this object because immutable commit revisions
do not have lock entries.

The combination of `repository`, revision type, and revision value identifies a
lock entry. Each combination MUST be unique. The lock file MUST contain exactly
one entry for every tag or branch revision in the resolved extension graph.
Missing, duplicate, and unused entries MUST cause validation to fail. Unknown
fields MUST also cause validation to fail.

An explicit lock update operation MUST resolve each tag or branch to a commit
and write the resulting full commit object ID. It MUST resolve a tag under
`refs/tags/` and a branch under `refs/heads/`. It MUST NOT fall back to another
reference type with the same name. If a tag is annotated, the operation MUST
record the commit to which the tag ultimately points, not the tag object ID.
The operation SHOULD produce stable output by sorting entries first by
`repository`, then by revision type, and then by revision value.

During normal validation or review, an implementation MUST load the commit from
the lock file. It MUST NOT resolve the tag or branch again or silently update
the lock file. This behavior prevents a moved tag or branch from changing the
rule set between two reviews of the same change. A user adopts changes to a mutable revision
through an explicit lock update, and the resulting commit change is visible in
the repository diff.

The lock file at the root of the repository being reviewed covers the complete
extension graph. Lock files found in extended repositories MUST NOT be used.

## Rule fields

```yaml
rules:
  - id: api.errors-use-problem-details
    level: SHOULD
    description: HTTP APIs should return errors in the Problem Details format.
    rationale: A shared error shape makes clients and operational tools simpler.
    applies_to:
      include:
        - api/**/*.{yaml,yml}
      exclude:
        - api/vendor/**
    guidance: Use the shared Problem Details schema.
    references:
      - https://www.rfc-editor.org/rfc/rfc9457
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | Yes | Stable identifier for the rule. |
| `level` | string | Yes | Requirement level: `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, or `MAY`. |
| `description` | string | Yes | Complete, testable statement of the required or recommended behavior. |
| `rationale` | string | Yes | Reason for the rule and the risk that it addresses. |
| `applies_to` | object | No | File paths for which the rule is relevant. If absent, the rule applies to all files. |
| `guidance` | string | No | Non-normative implementation guidance or a preferred alternative. |
| `references` | array of strings | No | URLs or repository-relative paths with more information. |

Unknown rule fields MUST cause validation to fail.

### Rule identifiers

An `id` MUST match this regular expression:

```text
^[a-z0-9]+(?:[._-][a-z0-9]+)*$
```

Identifiers SHOULD include an organization, project, or domain prefix to avoid
collisions, for example `acme.security.no-plaintext-secrets`. An identifier
MUST remain stable when the rule text changes without changing its meaning.

Each resolved rule ID MUST be unique. A repeated ID, whether it is defined in
one file or several extended files, MUST cause resolution to fail. Version 1
does not support implicit replacement, overrides, or disabling inherited rules.

### Requirement levels

Levels have these review meanings:

| Level | Meaning |
| --- | --- |
| `MUST` | The change is non-compliant if the required behavior is absent. |
| `MUST NOT` | The change is non-compliant if the prohibited behavior is present. |
| `SHOULD` | The behavior is expected, but a valid, documented reason can justify an exception. |
| `SHOULD NOT` | The behavior is discouraged, but a valid, documented reason can justify it. |
| `MAY` | The behavior is permitted. The rule supplies guidance and MUST NOT fail a review by itself. |

The `description` SHOULD use language that agrees with `level`. For example, a
`MUST NOT` rule should state what is prohibited. The level field is authoritative
if the description uses different requirement language.

### File applicability

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

Globs use these version 1 constructs:

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
backslash. Invalid or unsupported glob syntax MUST cause validation to fail.

File applicability is an initial filter, not proof that a rule is relevant or
compliant. The review agent can discard a selected rule after it examines the
change and its context.

## Resolution

An implementation MUST resolve a configuration as follows:

1. Load and validate the entry file and, when present, the lock file.
2. Resolve each `extends` item in list order using a depth-first traversal. For
   a tag or branch revision, get the commit from its lock entry.
3. Skip a source if the same source was already resolved during this traversal.
4. Add the rules from each extended file in their declared order.
5. Add the rules from the file that contains the `extends` declaration in their
   declared order.
6. Reject duplicate rule IDs from different sources.
7. Reject lock entries that do not correspond to a tag or branch in the
   resolved graph.

The result is one ordered list of rules. Rule order is stable input for review
and reporting, but it does not change rule priority or requirement level.

A local source is the same source when its canonical repository-relative path
is the same. A Git source is the same source when its repository URL, resolved
commit, and path are the same. This rule lets two extended files share a base
file without adding that base file's rules twice.

An implementation MUST detect extension cycles and report the chain of files
that forms the cycle. Failure to fetch, parse, validate, or resolve any source
MUST fail the complete configuration. An implementation MUST NOT silently skip
an invalid or unavailable source.

The implementation SHOULD cache Git sources by repository and resolved commit.
Cached content MUST be verified against the requested commit object ID before
use.

## Validation and diagnostics

Configuration processing has two phases:

1. Validation checks the YAML structure and values in each file.
2. Resolution loads all sources and checks constraints that apply to the
   complete rule set, such as unique IDs and extension cycles.

Diagnostics SHOULD contain:

- The source file or Git repository, requested revision, resolved commit, and
  path.
- The YAML path of the invalid value, such as `rules[2].level`.
- A concise reason and, when possible, the allowed values.
- The extension chain when the error came from an extended file.

YAML aliases and anchors MAY be accepted within one file. They MUST NOT change
the validation rules. Duplicate mapping keys MUST cause validation to fail.

### Machine-readable schemas

Version 1 has two JSON Schema Draft 2020-12 schemas:

- [`standards.schema.json`](../schemas/v1/standards.schema.json) validates
  `.standards.yml` files and extended configuration files. Its canonical `$id`
  is `https://getstandards.dev/schemas/v1/standards.schema.json`.
- [`standards-lock.schema.json`](../schemas/v1/standards-lock.schema.json)
  validates `.standards.lock` files. Its canonical `$id` is
  `https://getstandards.dev/schemas/v1/standards-lock.schema.json`.

The schemas ship with the package. `standards schema` prints the configuration
schema and `standards schema lock` prints the lock-file schema, so an editor or
external tool can read them without the canonical URL. To attach the schema to
`.standards.yml` in an editor, add a first line with the canonical URL:

```yaml
# yaml-language-server: $schema=https://getstandards.dev/schemas/v1/standards.schema.json
```

These schemas are normative for document structure and scalar value formats.
An implementation MUST also enforce the semantic validation and resolution
rules in this specification. JSON Schema does not enforce:

- Duplicate YAML mapping keys.
- Local path containment after symbolic links are resolved.
- Extension cycles or duplicate rule IDs within or across files.
- Lock-entry key uniqueness across the `sources` array.
- The complete Git tag and branch name grammar.
- The existence or type of a Git object or reference.
- The match between a mutable revision and its commit during a lock update.
- Missing or unused lock entries across the resolved extension graph.
- The complete version 1 glob grammar.

## Versioning

`version` identifies the configuration syntax, not the application version.
An implementation MUST reject unsupported versions. Backward-compatible
additions require a new version if version 1 readers would reject them as
unknown fields. A file of one version MAY extend a file of another supported
version; each file is validated using its declared version before all rules are
resolved.

## Version 1 exclusions

Version 1 does not define:

- Rule overrides or repository-specific exceptions.
- Variables, templates, or parameterized rule sets.
- Conditional rules based on branches, labels, authors, or pull request
  metadata.
- Inline scripts, commands, prompts, or executable checks.
- Integrity schemes other than a pinned Git commit object ID.
- The trust policy that decides whether review uses the base or head revision of
  `.standards.yml`.

These features can be specified separately after the core format and review
security model are stable.
