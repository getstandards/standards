# Specification: Standards library and pi extension

Status: draft for discussion. When accepted, the library surface becomes
[specs/library.md](./specs/library.md), the pi extension becomes
[specs/pi.md](./specs/pi.md), and [specs/cli.md](./specs/cli.md) gains a
reference to the library.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Purpose

A user who works inside the pi coding agent cannot start a review without
leaving the harness. This change splits Standards into three packages: a core
library that runs resolution and review, the existing CLI on top of it, and a
pi extension that starts a review from inside pi.

pi names this integration surface an extension, not a plugin. This document
uses pi's term.

The extension runs the review in the pi process. This gives it three things a
CLI subprocess cannot give:

- Model calls through pi's own resolved authentication. A review works with
  zero extra setup: no `standards auth login`.
- Typed progress events and typed report objects during the run.
- Findings delivered into the agent conversation, so the agent can fix them.

## Goals

- Extract a core library with a narrow public surface: resolution, review,
  and their types.
- Keep the CLI behavior identical. The CLI becomes the first library consumer.
- Ship a pi extension that starts a review with one command and feeds the
  findings to the agent.
- Keep credentials out of the core. Each surface supplies its own model
  access.

## Non-goals

- No wholesale export of internals. Cache internals, task packing, and prompt
  construction stay private to the core.
- No automatic review on pi events (turn end, pre-commit). A review spends
  model tokens; the user starts it. An opt-in trigger MAY come later.
- No agent-invocable review tool in the first version. It needs a spend
  policy first.
- No change to the GitHub Action surface.

## Packages

| Package | Contents |
| --- | --- |
| `@getstandards/core` | Resolution, the review pipeline, the report and diagnostic types, the models interface. No credential code. |
| `@getstandards/standards` | The CLI. Keeps its name, its `standards` bin, and the action build. Owns credentials (`auth.json`, the `auth` commands) and terminal rendering. |
| `@getstandards/pi` | The pi extension. Depends on `@getstandards/core` and adapts pi's model registry. |

`@getstandards/standards` keeps its published name because it owns the
`standards` bin and the action build (`build:action`). A rename would break
installs for no user-visible gain.

## Library surface

The core exports the seam that the terminology already defines: resolution is
one value, and a review evaluates a change scope against it.

```ts
// Sketch, not final signatures.
resolve(options: ResolveOptions): Promise<Resolution>;
review(request: ReviewRequest): Promise<Report>;
```

- `resolve` runs configuration loading and rule discovery. It returns the
  resolution: the ordered rules, the resolved Git commits, and the warnings.
- `review` receives the resolution, one change scope, the targets, the
  selected models, and a models runtime. It returns the report.
- `review` MUST accept an `AbortSignal` and MUST report progress through a
  callback or an async iterable, so a host can render steps, cost, and
  findings as they happen.
- Failures surface as diagnostics, not process exit statuses. Exit statuses
  stay a CLI concern.
- The core exports the types the surface needs: resolution, rule, change
  scope, report, finding, diagnostic, and the progress event.

Every addition to this surface is a compatibility contract. When a consumer
needs more, export it then, deliberately.

### Models runtime

The seam already exists in the code: `runReviewAgent` calls
`request.models.completeSimple(...)`
(`packages/standards/src/review/review-agent.ts`). The core promotes this to
its boundary.

- The core MUST define a minimal models interface: only the calls the
  pipeline makes. It MUST NOT read credentials, environment variables, or
  credential files.
- The CLI supplies `createStandardsModels` (pi AI SDK built-in providers plus
  the `auth.json` store) and `createAutomationModels` (the restricted CI
  variant). Both already exist in
  `packages/standards/src/credentials/models-runtime.ts` and move to the CLI
  package.
- The pi extension supplies an adapter over pi's model registry.

## pi extension

### Host API

Verified against the installed pi 0.84.3 (`docs/extensions.md` and
`dist/core/model-registry.d.ts` of `@earendil-works/pi-coding-agent`):

- An extension is a TypeScript module that receives an `ExtensionAPI` object
  and can register commands.
- `ctx.model` is the user's active model.
- `ctx.modelRegistry.complete(model, context, options)` makes a model call
  through pi's resolved authentication. The bundled examples (`qna.ts`,
  `summarize.ts`) use this pattern.
- `ctx.modelRegistry.find(provider, modelId)` and
  `hasConfiguredAuth(model)` resolve and check a model.
- `ctx.modelRegistry.getProviderAuth(provider)` returns the raw API key,
  headers, and base URL. The extension does not need it; the `complete` path
  covers every call.

The registry method is `complete`; the core seam is `completeSimple`. The
extension therefore ships a small adapter, not a pass-through.

### Distribution and install

pi's distributable unit is a pi package: an npm or git package that declares
its extensions under a `pi` key in `package.json`
(`docs/packages.md` of pi 0.84.3).

- `@getstandards/pi` MUST be a pi package: the `pi-package` keyword and a
  `pi.extensions` manifest entry that points at the built extension.
- A user installs it with `pi install npm:@getstandards/pi` (user-level) or
  `pi install -l npm:@getstandards/pi` (project-level, written to
  `.pi/settings.json`). A committed project setting installs the extension
  for every teammate on startup, after project trust.
- `pi -e npm:@getstandards/pi` tries it for one run without installing.
- The package mechanism installs npm dependencies, so the extension MAY
  depend on `@getstandards/core` normally. A loose extension file in
  `~/.pi/agent/extensions/` or `.pi/extensions/` cannot carry dependencies
  and is not a supported install path.

### Command

The extension registers one command: `/standards`.

- `/standards` runs a review of the default change scope: `working-tree`, as
  [specs/cli.md](./specs/cli.md) defines it.
- Arguments pass through to the same scope and filter surface the CLI
  defines: `--staged`, `--base <revision>`, and targets. The extension MUST
  NOT invent its own scope selection.
- The extension renders progress during the run and a summary after it:
  conclusion, blocking count, warning count, cost, and one line per finding
  with rule id, path, and lines.
- After the summary, the extension delivers the findings into the agent
  conversation as one message, so the agent can fix them and the user can run
  `/standards` again. A finding already carries `path`, `lines`, `evidence`,
  `reason`, and an optional `suggested_change`; that is what an agent needs.

### Model selection

The review keeps the model selection that
[specs/review.md](./specs/review.md) defines, resolved through pi's registry:

1. When settings or arguments select a model, the extension resolves it with
   `find` and checks it with `hasConfiguredAuth`. This keeps results
   consistent with CI.
2. Otherwise the extension uses `ctx.model`, the model the user already
   selected in pi.

With rule 2, a review inside pi runs on the user's active model, which can
differ from the models CI uses. This is a deliberate trade: zero setup over
strict CI parity. A team that wants parity sets the model in settings.

### Failure handling

- A review with blocking findings is a completed review, not an error.
- A diagnostic renders with its category, problem, and next action. The two
  expected cases are a missing entry file and a selected model without
  configured authentication in pi.

## Implementation sequence

1. Extract `@getstandards/core` inside the monorepo. The CLI is its only
   consumer. Behavior is identical and every existing test passes unchanged.
   This step ships alone.
2. Promote the models seam: the core-owned minimal interface, the CLI-owned
   runtimes.
3. Build `@getstandards/pi`: the registry adapter, the `/standards` command,
   the progress rendering, the findings message.
4. Update `release-please-config.json`, the workspace scripts, and the specs.
   The action build path does not move.

## Tests

- Core: the existing resolution and review tests move with the code and pass
  unchanged.
- CLI: the existing CLI tests pass unchanged against the extracted core.
- pi extension: adapter tests that map the core models interface to a fake
  registry with `complete`, and a command test that runs a review against a
  fixture repository with a fake models runtime.

## Open questions

- Does the findings message enter the agent context after every `/standards`,
  or only on an explicit variant? The draft says always; a report-only flag
  can come later.
- The exact minimal models interface. It falls out of step 2, when the calls
  the pipeline makes are enumerated.
- New terminology entries (`core`, `models runtime`, `pi extension`) go into
  `TERMINOLOGY.md` when the spec is accepted.
