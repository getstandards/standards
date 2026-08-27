# Standards review CLI redesign

Status: draft for discussion. When accepted, this document merges into
[specs/cli.md](./specs/cli.md) and [specs/review.md](./specs/review.md).

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be
interpreted as described by RFC 2119.

## Problem

Today `standards review` always diffs two commits: a base revision and the
`HEAD` commit. Uncommitted work is invisible to the review; a user must commit
before a review can see a change. The agents read extra context from the
working tree, which can disagree with the reviewed diff. There is also no way
to review a commit range, only the staged changes, or a subset of the rule
set.

## Change scope

A review compares exactly one **change scope**. The scope replaces the base
and head revision pair as the input that selects the change. There are three
kinds:

| Kind | Change | Git diff |
| --- | --- | --- |
| `commits` | Between two commits. | `git diff <base> <head>` |
| `working-tree` | Between a base commit and the working tree, staged and unstaged changes included, untracked files included as added files. | `git diff <base>` plus one `--no-index` diff per untracked file |
| `staged` | Between `HEAD` and the index: only the staged changes. | `git diff --cached` |

- The pipeline (selection, planning, evaluation, verification, report) is
  unchanged. Every scope produces the same `ChangedFile` shape.
- An untracked file MUST be included in the `working-tree` scope only when
  Git does not ignore it (`git ls-files --others --exclude-standard`).
- The GitHub Action keeps its current behavior through the `commits` scope.

## Command surface

```
standards review [options] [target...]
```

| Invocation | Scope | Meaning |
| --- | --- | --- |
| `standards review` | `working-tree` | Review the current branch against the merge base of `HEAD` and the remote default branch. All uncommitted changes are included. |
| `standards review --base <revision>` | `working-tree` | Same, with `<revision>` as the base. |
| `standards review --staged` | `staged` | Review only the staged changes. |
| `standards review --range <base>..<head>` | `commits` | Review a commit range. |
| `standards review --all` | `working-tree` | Full audit: the base is the empty tree, so every tracked and untracked file counts as added. |
| `standards review [target...]` | any | Limit the review to the changed files a target matches. Targets combine with every scope and with the rule set filters. |
| `standards review --rule <id>` | any | Limit the rule set to one rule. |
| `standards review --source <folder>` | any | Limit the rule set to the rules of one mapped knowledge folder. |

Running `standards` without a command keeps printing help. A bare invocation
MUST NOT start a review, because a review spends model tokens.

### Scope selection

The scope options `--all`, `--base`, `--range`, and `--staged` are mutually
exclusive. An invocation that gives more than one MUST fail with a diagnostic
that names the two options and exit with status `2`.

Without a scope option, the base revision is the merge base of `HEAD` and the
remote default branch (`refs/remotes/origin/HEAD`). When that merge base
cannot be resolved, the command MUST fail with a diagnostic that asks for
`--base`, `--range`, or `--all` and exit with status `2`.

Every scope requires a repository with at least one commit. `HEAD` failing to
resolve MUST produce a diagnostic and exit status `2`.

### `--range <base>..<head>`

`--range` accepts the Git range forms:

- `A..B`: the base is `A`, the head is `B`. Example: `main..HEAD`,
  `HEAD~3..HEAD`.
- `A...B`: the base is the merge base of `A` and `B`, the head is `B`.

Both revisions MUST resolve to commits. A value without `..`, with an empty
side, or with an unresolvable revision MUST produce a diagnostic that shows
the expected form and exit with status `2`.

The agents read extra context from the working tree. When the range head is
not the checked-out commit, that context can disagree with the reviewed
change. The command does not check out the range head; the spec states the
mismatch instead. The same statement applies to `--staged` when the working
tree differs from the index.

### Targets

Target behavior is unchanged: a target is a repository-relative file or
directory path, targets filter the changed files, and they do not change the
scope. Target existence validation follows the scope:

- `commits`: the target exists in the head commit, or matches a deleted
  file's base path.
- `working-tree`: the target exists in the working tree, or matches a deleted
  file's base path.
- `staged`: the target exists in the index, or matches a deleted file's base
  path.

A valid target that matches no changed file stays a compliant empty selection
with zero model tokens.

### `--rule <id>`

`--rule <id>` limits the resolved rule set to the rule with that exact id
before selection runs. An id that matches no resolved rule MUST produce a
diagnostic and exit with status `2`; the next action names `standards
validate` as the command that lists the resolved rule ids.

`--rule` combines with every scope and with targets:

```
standards review src/foo.ts --rule clickhouse.2026-08-26-ttl-v2
```

reviews only the changed hunks of `src/foo.ts` against that one rule. To
check a whole file against one rule regardless of changes:

```
standards review --all src/foo.ts --rule clickhouse.2026-08-26-ttl-v2
```

This is the cheap loop for testing a rule while writing it.

### `--source <folder>`

`--source <folder>` limits the resolved rule set to the rules that a folder
mapping with that folder name produced, for example `--source decisions` with
the mapping `folders: { decisions: MUST }`. A name that matches no mapped
folder of any knowledge source MUST produce a diagnostic that lists the
mapped folder names and exit with status `2`.

`--rule` and `--source` are mutually exclusive: `--rule` already names one
rule. Giving both MUST fail with a diagnostic and exit with status `2`.

Open naming point: `TERMINOLOGY.md` defines *source* as a knowledge source
entry, not a folder. `decisions` is a folder mapping. Either this option is
renamed `--folder`, or the spec defines `--source` as "the rules of one
mapped folder". Decision pending.

### Report counts under rule set filters

`--rule` and `--source` shrink the rule set before the pipeline runs. The
report's `resolved_rules` count reflects the filtered set. The report format
version does not change.

## Implementation notes

- `Rule` gains a `folder` field: the mapped folder name that produced the
  rule. Resolution already knows it; the field also serves the planned
  `standards rules` command. Agent prompts pick rule fields explicitly, so
  the field does not reach a prompt.
- The untracked-file diff (`git diff --no-index -- /dev/null <file>`) emits
  `new file mode` and `+++ b/<path>` markers, verified to parse with the
  existing unified-diff parser. `git diff --no-index` exits `1` when the
  files differ; the Git helper accepts that status for diff commands.
- `RunReviewInput` replaces `baseRevision`/`headRevision` with the scope.
  The GitHub Action passes a `commits` scope; nothing else changes there.
- Verbose output prints the scope: the base revision and `working tree`,
  `index`, or the head commit as the head.

## Behavior changes from the current CLI

| Current | New |
| --- | --- |
| `standards review` fails when no remote default branch exists, otherwise reviews merge base to the `HEAD` commit. | Same base; the head becomes the working tree, so uncommitted changes are reviewed. |
| `--base <revision>` reviews `<revision>` to the `HEAD` commit. | Reviews `<revision>` to the working tree. |
| `--all` audits the tracked files of the `HEAD` commit. | Audits the working tree, untracked files included. |
| Uncommitted work requires a commit to be reviewed. | The default scope includes it. |
| No commit range, staged-only, or rule set filtering. | `--range`, `--staged`, `--rule`, `--source`. |

## Open decisions

1. `--source` vs `--folder` naming (see above).
2. `--all` semantics change from `HEAD` commit to working tree: confirm this
   is acceptable for existing automation that runs `--all` on a clean
   checkout (result is identical when the tree is clean).
3. Untracked files in the `working-tree` scope: included as added files, as
   specified above. Confirm.
4. `--staged` and `--range` context mismatch: accepted and stated, not
   solved. Confirm.
