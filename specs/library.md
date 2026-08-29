# Standards core library

Defines `@getstandards/core`, the library that runs resolution and review, and
the surface that every Standards host builds on.

## Purpose

Standards ships more than one surface: the `standards` command line, the GitHub
Action, and the pi extension. Each surface renders differently, holds different
credentials, and reports failure differently, but each one runs the same
resolution and the same review. Without a library, a new surface either copies
the pipeline or starts a `standards` subprocess and reads its text output.

The core holds the pipeline once. A surface supplies model access and renders
the result.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the packages, the public surface of the core, and the
models runtime seam. It does not change the configuration format, the review
pipeline, the report format, or the command line behavior. Those stay defined
by [Standards configuration](./configuration.md), [Standards review](./review.md),
and [Standards command line](./cli.md).

## Packages

| Package | Contents |
| --- | --- |
| `@getstandards/core` | Resolution, the review pipeline, the report and diagnostic types, and the models runtime interface. No credential code. |
| `@getstandards/standards` | The command line. Owns the `standards` bin, the action build, credentials (`auth.json` and the `auth` commands), and terminal rendering. |
| `@getstandards/pi` | The pi extension, defined in [Standards pi extension](./pi.md). |

`@getstandards/standards` keeps its published name because it owns the
`standards` bin and the action build. A rename would break installs for no
user-visible gain.

Every package in the repository carries one version. A release bumps them
together.

## Public surface

`@getstandards/core` has two entry points.

The default entry point, `@getstandards/core`, is the supported surface. Every
name it exports is a compatibility contract:

- Resolution: `loadRules`, the `Resolution`, `Rule`, `KnowledgeSource`,
  `ResolvedGitSource`, and `RuleWarning` types, and
  `ConfigurationResolutionError`.
- Change scope: `resolveChangeScope`, the `ChangeScope` and
  `ChangeScopeOptions` types, and `ReviewInputError`.
- Rule set filters: `filterRuleSet` and `ReviewRuleFilterError`.
- Review: `runReview`, the `RunReviewInput` type, the report types, and the
  failure types `ModelSelectionError`, `ReviewProviderError`, and
  `ReviewTargetError`.
- The models runtime interface, `ReviewModels`.
- The source cache a run needs: `openRunGitSourceStore` and
  `createImportProgressReporter`.
- Settings: `resolveStandardsSettingsPath`, `readStandardsSettingsFile`, and
  their error and diagnostic helpers.

The second entry point, `@getstandards/core/internal`, holds what the
first-party command line needs beyond that surface: the cache store the
`standards cache` command manages, the configuration schema, the knowledge
document parser, and shared Git, YAML, and error helpers. It carries no
compatibility promise. A consumer outside this repository MUST use
`@getstandards/core`.

The core MUST NOT export prompt text, task packing, or the agent loop. A name
enters either entry point when a consumer needs it, not before: an unused
export is a promise nobody asked for.

## Resolution and review

`loadRules(repositoryRoot, options)` runs configuration loading and rule
discovery and returns the resolution: the ordered rules, the resolved Git
commits, and the warnings.

`runReview(input)` receives the resolution, one change scope, the targets, the
model selection options, and a models runtime, and returns the report.

- `runReview` MUST accept an `AbortSignal`, so a host can cancel a review that
  is spending tokens.
- `runReview` MUST report progress through callbacks, so a host can render
  steps and findings while they happen.
- A failure surfaces as a thrown typed error, never as a process exit status.
  Exit statuses stay a command line concern.
- A review with blocking findings is a completed review, not a failure.

Both functions are pure with respect to credentials: neither reads a credential
file, a credential environment variable, or an ambient provider credential.

## Models runtime

`ReviewModels` is the seam between the core and a host's model access. It
declares only the calls the pipeline makes:

```ts
interface ReviewModels {
	getProviders(): readonly ReviewProvider[];
	checkAuth(provider: string): Promise<AuthCheck | undefined>;
	getModel(provider: string, model: string): Model<Api> | undefined;
	completeSimple(
		model: Model<Api>,
		context: Context,
		options?: ReviewCompleteOptions,
	): Promise<AssistantMessage>;
}
```

- The core MUST NOT read credentials, environment variables, or credential
  files through this interface or around it.
- `checkAuth` answers what credential a provider resolves to now. Model
  selection uses it to reject a model whose provider has no credential, and the
  review uses it to decide whether the reported cost is charged or an estimate.
- The pi AI SDK `Models` collection satisfies the interface, so a host that
  already holds one passes it unchanged.

Each surface supplies its own runtime:

| Surface | Runtime |
| --- | --- |
| Command line | `createStandardsModels`: every built-in provider over the `auth.json` credential store and the ambient auth context. |
| GitHub Action | `createAutomationModels`: every built-in provider over an empty credential store and an auth context restricted to the accepted API key variables. |
| pi extension | An adapter over pi's model registry, defined in [Standards pi extension](./pi.md). |

Both command line runtimes live in `@getstandards/standards`, next to the
credential file they read. A credential never reaches the core.

## Shared scope and filter behavior

A host MUST NOT invent its own change scope selection or rule set filter. The
core owns both, so `standards review --staged` and a `--staged` review started
from another surface compare the same change:

- `resolveChangeScope` implements the scope rules of
  [Standards command line](./cli.md): the default working tree against the merge
  base, `--base`, `--range`, `--staged`, and `--all`.
- `filterRuleSet` implements `--rule` and `--folder`, including the failure when
  a value names no resolved rule and no mapped folder.

## Version 1 exclusions

This version does not define:

- A stable serialized protocol. The surface is a TypeScript API.
- A plugin interface for rule discovery or evaluation.
- Streaming of partial findings. Progress reports counts, not findings.
