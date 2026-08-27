# Terminology

Canonical words used across Standards code and documentation.

## Terms

- **action output** — One value the action sets for later workflow steps: `conclusion`, `blocking-count`, `warning-count`, `total-cost`, or `report-file`.
- **applies_to** — The `include`/`exclude` glob filter that scopes a rule to a subset of repository files. Only a folder mapping sets it: file applicability is a consumer decision, so a frontmatter `applies_to` field is ignored. The object form scopes every rule in the folder; the list form scopes groups of documents through per-entry `documents` globs.
- **branch** — The branch a Git knowledge source follows, set by `branch` without the `refs/heads/` prefix. When absent, the loader uses the repository's default branch. The loader resolves it to its current commit at the start of every run.
- **bundle** — One directory tree of knowledge documents in the Open Knowledge Format. A knowledge source holds one bundle. OKF does not specify folder names, so the folder mapping states which folders hold rules.
- **change scope** — The change one review compares. It is `commits` (between two commits), `working-tree` (between a base commit and the working tree, untracked files included), or `staged` (between `HEAD` and the index). The `--base`, `--range`, `--staged`, and `--all` options of `standards review` select it.
- **cache read tokens** — The input tokens of a step that the provider served from its prompt cache, reported as `cache_read_tokens`.
- **cache write tokens** — The input tokens of a step that the provider wrote to its prompt cache, reported as `cache_write_tokens`.
- **check run** — The GitHub check named `Standards` that one action run creates for the head commit and completes with the conclusion and the report.
- **configuration** — The validated `.standards.yml` document (`version` and `sources`).
- **cost** — The model spend of a review in United States dollars, computed by the provider SDK from its per-request rates. The report carries one `cost` per step and their sum as `total_cost`.
- **cost basis** — What the review's cost number means: `charged` (an API key credential), `list_price_estimate` (a subscription credential), or `none` (every selected model has a zero cost).
- **derived id** — The rule `id` computed from a document path relative to its mapped folder: the `.md` extension removed and `/` replaced with `.`.
- **diagnostic** — A structured, human-actionable error report with category, source, field, problem, and next action.
- **entry file** — The `.standards.yml` or `.standards.yaml` at the repository root that starts resolution. A repository holds at most one.
- **finding** — One reported rule violation: `rule`, `path`, `lines`, `evidence`, `reason`, an optional `suggestion`, and an optional `suggested_change`.
- **finding comment** — One pull request review comment that carries one confirmed finding on its `path` and `lines`, with an applicable suggested change when one is present, found by the `<!-- standards:finding:v1:<fingerprint> -->` marker on its first line.
- **fingerprint** — The stable identifier of a finding whose comment is no longer mapped to the current diff: the first sixteen characters of the lowercase hex SHA-256 digest of the rule `id`, the `path`, and the source anchor, joined with a newline.
- **folder mapping** — One entry of a source `folders` object: a bundle-relative folder mapped to a requirement `level`, with optional `documents` and `applies_to` filters. Enforcement is opt-in per folder.
- **full review** — A review whose base revision is the empty tree, so the change contains every file of the scope's head side as an added file.
- **glob** — A repository-relative, OS-independent path pattern. Supported constructs are `*`, `?`, `**`, `[abc]`, and `{a,b}`.
- **id prefix** — The optional `id_prefix` of a knowledge source, added before every derived id from that source to resolve identity conflicts between sources.
- **knowledge document** — One markdown file with YAML frontmatter in the Open Knowledge Format. An enforced knowledge document is a rule.
- **knowledge source** — One `sources` entry of the configuration: a local directory (`path`) or a Git repository (`repository`, optional `branch`, optional `path`) that holds a bundle, with its `folders` mappings and optional `id_prefix`.
- **level** — The requirement level of a rule, set by its folder mapping: `MUST` (blocking) or `SHOULD` (advisory).
- **model reference** — A provider and model identifier in `<provider>/<model>` form, such as `anthropic/claude-sonnet-5`. It is the value that `--model` and the model settings fields accept, and the value that `standards models` prints on every model line.
- **provider** — One model provider registered in the pi AI SDK, named by its SDK provider id. The id is the credential key: `openai` and `openai-codex` are separate providers with separate credentials.
- **repository root** — The canonicalized root directory where `.standards.yml` must live.
- **resolution** — The complete output of configuration loading and rule discovery: the ordered rules, the resolved Git commits, and the warnings. The review pipeline receives it as one value.
- **review** — The act of an agent that evaluates a change — the hunks of one change scope — against the resolved rule set.
- **rule** — One enforced knowledge document: `id`, `level`, `folder` (the mapped folder it came from), `title` (the rule statement), an optional `description`, the markdown `body`, and an optional `applies_to`.
- **rule set** — The flattened ordered list of rules after resolution.
- **rule verdict** — The evaluation agent's decision for one rule and file pair: `compliant` or `violated`, with one finding per violation.
- **source anchor** — The exact source text covered by a finding's `lines`, read from the head revision or from the base revision for a deleted file, with `\n` between lines and no final line break.
- **suggestion** — Optional remediation advice on a finding, produced by the evaluation agent and specific to the change. It is prose, not replacement code.
- **suggested change** — An optional exact replacement for a finding's `lines`, proposed during evaluation and accepted during verification. It is report data that a user can inspect or apply, not an automatic repository change.
- **summary comment** — The one pull request comment that carries the report, found by the `<!-- standards:report:v1 -->` marker on its first line.
- **target** — A repository-relative path, file or directory, passed to `standards review` to limit the review to the changed files it matches.
- **version** — The integer discriminator for document syntax. The configuration format, report format, and comment marker formats evolve independently.
- **warning** — One report entry for a knowledge document the loader skipped: the document and the problem. A warning never fails the run.
