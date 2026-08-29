# Specification: simplify OKF rule discovery and setup

Status: ready for implementation.

## Purpose

This change simplifies how a user connects Open Knowledge Format (OKF)
documents to Standards. It also removes internal data and resolution work that
the review does not use.

Standards MUST NOT define a folder layout for an OKF bundle. The user selects
the folders and requirement levels that apply to each knowledge source.

## Goals

- Make `.standards.yml` describe user policy, not loader implementation.
- Let a user configure an existing OKF bundle without changing its layout.
- Make `standards init` discover the user's layout through an interactive
  dialogue.
- Keep the resolved rule data limited to fields that the review uses.
- Pass one resolution value through the review pipeline.
- Remove rule alias work until suppressions use aliases.
- Keep source and cache lookup keys searchable as text.

## Non-goals

This change does not:

- define standard OKF folder names,
- create `decisions`, `practices`, or other folders by default,
- pin Git sources to a tag or commit,
- add authentication, cache, model, or review settings to `.standards.yml`,
- implement suppressions,
- add source priorities or rule ordering semantics,
- add names or descriptions that no command reports.

## Domain model

### Knowledge source

A knowledge source is one local directory or Git repository that contains an
OKF bundle. A Git source can select a path inside the repository.

### Folder mapping

A folder mapping selects one folder inside a knowledge source. It sets the
requirement level of the rules discovered in that folder. It can also filter
the knowledge documents and target repository files that those rules apply to.

The folder name has no required meaning. Standards MUST NOT infer a level from
the folder name.

### Rule

A rule is one enforced knowledge document after resolution. A rule is not a
configuration entry. Its requirement level and consumer scope come from its
folder mapping.

### Resolution

A resolution is the complete output of configuration loading and rule
discovery. It contains the ordered rules, resolved Git sources, and warnings.

## Configuration

The entry file is `.standards.yml` or `.standards.yaml` at the repository
root; a repository that contains both MUST fail resolution. The configuration
version remains `2` because version 2 is not yet released.

### Complete example

```yaml
version: 2

sources:
  - path: knowledge
    folders:
      architecture: MUST
      engineering-guides:
        level: SHOULD
        documents:
          exclude:
            - templates/**
        applies_to:
          include:
            - src/**

  - repository: https://github.com/acme/shared-knowledge.git
    branch: main
    path: knowledge
    id_prefix: shared
    folders:
      reliability: MUST
```

### Top-level fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | integer `2` | Yes | Configuration syntax version. |
| `sources` | array | No | Knowledge sources. The default is an empty array. |

The configuration MUST NOT contain top-level `name` or `description` fields.
No implemented behavior uses them.

### Local source

A local source has this form:

```yaml
- path: knowledge
  folders:
    architecture: MUST
```

`path` is relative to the repository root. It identifies the root of the OKF
bundle.

### Git source

A Git source has this form:

```yaml
- repository: https://github.com/acme/shared-knowledge.git
  branch: main
  path: knowledge
  id_prefix: shared
  folders:
    reliability: MUST
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `repository` | HTTPS or SSH repository URL | Yes | Git repository that contains the bundle. |
| `branch` | Git branch name | No | Branch to follow. The default is the remote default branch. |
| `path` | relative path | No | Bundle root inside the Git repository. The default is the repository root. |
| `id_prefix` | rule id prefix | No | Prefix added to every derived rule id from this source. |
| `folders` | folder mapping object | Yes | Folders that Standards enforces. |

The configuration uses `branch`, not `ref`, because Standards accepts only a
branch. The Git fields are not nested under a `git` field.

### Rule id prefix

`id_prefix` solves identity conflicts between independent knowledge sources.
It MUST match the rule id grammar without a final dot.

For this source:

```yaml
id_prefix: platform
folders:
  practices: SHOULD
```

the document `practices/api/pagination.md` has the rule id
`platform.api.pagination`.

When `id_prefix` is absent, the derived id does not change. A duplicate-id
diagnostic SHOULD tell the user that `id_prefix` can resolve a conflict.

### Folder mappings

The short form maps a folder directly to a requirement level:

```yaml
folders:
  architecture: MUST
  engineering-guides: SHOULD
```

The expanded form adds document and target file filters:

```yaml
folders:
  engineering-guides:
    level: SHOULD
    documents:
      include:
        - active/**/*.md
      exclude:
        - templates/**
    applies_to:
      include:
        - src/**
      exclude:
        - src/generated/**
```

The short form is equivalent to an expanded form that contains only `level`.

Two mapped folders in the same source MUST NOT overlap. A mapped folder MUST
exist and remain inside its knowledge source.

### Knowledge document filter

`documents` filters knowledge documents relative to the mapped folder.

| Field | Default | Meaning |
| --- | --- | --- |
| `include` | `**/*.md` | Documents that can become rules. |
| `exclude` | empty | Documents that cannot become rules. Exclusion wins. |

Standards MUST NOT give `index.md` or any other file name a special meaning.
Every Markdown document is eligible unless the configuration excludes it.

This filter is consumer policy. It lets a user consume an OKF bundle that
mixes enforceable and informational documents in one folder. The bundle does
not need a Standards-specific layout.

### Target repository applicability

The folder mapping `applies_to` filter scopes rules to target repository
files. Its `include`/`exclude` globs are relative to the target repository
root. The object form scopes every rule in the folder. The list form scopes
groups of documents: each entry carries an optional folder-relative
`documents` glob and its own filter, and the first entry that matches a
document decides that rule's filter. A document that no entry matches gets no
filter.

A knowledge document does not set file applicability. Which files a rule
applies to depends on the target repository layout, so only the consumer
configuration decides it. A frontmatter `applies_to` field is accepted and
ignored, like any other unused field.

The folder filter lets a consumer apply a shared bundle to its own repository
layout. The shared bundle does not need to know that layout.

## Interactive initialization

`standards init` MUST use an interactive dialogue when standard input and
standard output are terminals.

### Dialogue

The dialogue MUST:

1. Ask whether the knowledge source is local or Git.
2. Ask for the local bundle root, or the Git repository, branch, and optional
   bundle path.
3. Scan the source and show folders that contain Markdown documents.
4. Let the user select one or more folders.
5. Ask for the `MUST` or `SHOULD` level of each selected folder.
6. Let the user configure document exclusions when a selected folder contains
   documents that must not become rules.
7. Let the user set a target repository `applies_to` filter when needed.
8. Ask for an optional `id_prefix`.
9. Let the user add another knowledge source.
10. Show the complete `.standards.yml` preview.
11. Ask for confirmation before it writes the file.

The dialogue MUST NOT propose semantic folder names. It can show existing
folder names and document counts.

For a Git source, the dialogue can use the normal source cache to scan the
selected branch. If the source cannot be scanned, the user can enter folder
paths manually.

Cancellation MUST leave the repository unchanged. If an entry file already
exists, `init` MUST refuse to replace it.

### Non-interactive use

Without a terminal, `standards init` MUST NOT write an empty or assumed
configuration. It MUST report that interactive input is required and leave the
repository unchanged.

Command options for non-interactive initialization are deferred until a real
automation use case defines them.

### Completion output

After it writes the configuration, `init` MUST tell the user to run
`standards validate`. It MUST NOT create knowledge folders or documents unless
the user explicitly selected a future create-folder operation. That operation
is not part of this change.

## Rule document parsing

The parser continues to read the rule statement, optional summary, lifecycle
fields, target applicability, and Markdown body.

The runtime rule MUST contain only fields used by selection, review, or
reporting:

```ts
interface Rule {
  id: string;
  level: RequirementLevel;
  title: string;
  description?: string;
  body: string;
  applies_to?: AppliesTo;
}
```

The runtime rule MUST NOT contain `type`, `tags`, or `aliases`. Standards MUST
accept and ignore unused OKF frontmatter fields. It MUST NOT reject a document
because an unused field has a shape that Standards does not consume.

An absent description stays absent. The loader MUST NOT convert it to an empty
string and later convert it back to an absent value.

## Superseded documents

Suppressions are not implemented. No current behavior reads rule aliases.

For this change:

- a document with `superseded_by` does not become a rule,
- the final document is discovered and enforced through its own path,
- the loader does not build aliases,
- the loader does not follow alias chains,
- the loader does not validate alias cycles or missing alias targets.

Alias chain validation and alias-based suppression MUST be implemented with
suppressions, not before them.

## Resolution interface

The loader MUST return one value named `Resolution`:

```ts
interface Resolution {
  rules: Rule[];
  gitSources: ResolvedGitSource[];
  warnings: RuleWarning[];
}
```

`runReview` MUST accept the resolution as one input. Callers MUST NOT unpack it
into separate `ruleSet`, `gitSources`, and `warnings` arguments and then pass
the same fields through each review layer.

Review steps that need only rules can read `resolution.rules`. Report building
can read source and warning metadata from the same resolution.

## Source lookup keys

Source and checkout caches MUST NOT put literal NUL characters in TypeScript
source files. Literal NUL characters make plain-text search tools treat the
file as binary.

Tuple keys can use `JSON.stringify([first, second])` or another searchable
text representation. The chosen representation MUST not introduce ambiguous
keys.

## Validation output

`standards validate` MUST show:

- the configuration path,
- each knowledge source,
- each mapped folder and its level,
- each discovered rule with document path, derived id, and resolved
  `applies_to` scope (every file when unscoped),
- resolved Git commits,
- skipped document warnings,
- total rule counts by level.

This output lets the user confirm the interactive choices before a review.

## Deferred configuration options

Do not add these options in this change:

- source display name or description,
- enabled or disabled state,
- source or rule priority,
- authentication fields,
- cache fields,
- model selection,
- strict warning policy,
- Git tag or commit selection.

Add an option only when a proven user workflow needs it.

## Implementation sequence

1. Replace the configuration schema and examples with the new source and
   folder mapping shape.
2. Rename `ref` to `branch` in code, reports, diagnostics, specifications, and
   terminology.
3. Implement `id_prefix`, document filters, and folder-level `applies_to`.
4. Remove the hard-coded `index.md` exclusion.
5. Replace `standards init` with the interactive dialogue.
6. Reduce the runtime `Rule` type and remove unused frontmatter validation.
7. Remove alias collection and chain traversal.
8. Introduce `Resolution` and pass it through the review pipeline.
9. Replace literal NUL cache keys.
10. Update CLI help, canonical specifications, README examples, and
    `TERMINOLOGY.md`.
11. Rebuild the action bundle.

## Tests

Tests MUST cover:

- short and expanded folder mappings,
- local and Git source syntax,
- default branch and selected branch resolution,
- optional `id_prefix` and duplicate-id diagnostics,
- document include and exclude filters,
- `index.md` discovery when it is not excluded,
- folder-level and document-level applicability intersection,
- interactive local source setup,
- interactive Git source setup,
- manual folder entry when scanning fails,
- multiple sources,
- preview confirmation and cancellation,
- refusal to replace an existing entry file,
- non-interactive refusal without explicit options,
- the reduced runtime rule fields,
- superseded document exclusion without alias resolution,
- one resolution value passed into review,
- searchable source lookup keys.

Git test repositories MUST disable commit signing in their local configuration.
Tests must not depend on the user's global Git configuration.

## Acceptance criteria

The implementation is complete when:

- the configuration accepts the syntax in this specification,
- initialization does not assume an OKF folder layout,
- a user can preview and create a configuration through the dialogue,
- validation shows exactly which documents became rules,
- the review receives one resolution value,
- runtime rules contain no unused OKF metadata or aliases,
- source files contain no literal NUL characters,
- canonical docs and terminology agree with the implementation,
- focused tests, the full test suite, type checking, and formatting checks pass.
