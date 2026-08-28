# Standards pi extension

Defines `@getstandards/pi`, the extension that starts a Standards review from
inside the pi coding agent.

## Purpose

A user who works inside pi cannot start a review without leaving the harness.
Starting the `standards` command from pi works, but it needs its own login, it
returns text a host must parse, and its findings never reach the agent that
could fix them.

The extension runs the review in the pi process. That gives it three things a
subprocess cannot give:

- Model calls through pi's own resolved authentication. A review works with
  zero extra setup: no `standards auth login`.
- Typed progress events and a typed report during the run.
- Findings delivered into the agent conversation, so the agent can fix them.

pi names this integration surface an extension, not a plugin. This document
uses pi's term.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the extension package, the `/standards` command, model
selection inside pi, and failure reporting. The review itself is defined by
[Standards review](./review.md), and the library the extension calls is defined
by [Standards core library](./library.md).

## Distribution and install

pi's distributable unit is a pi package: an npm or Git package that declares its
extensions under a `pi` key in `package.json`.

`@getstandards/pi` MUST be a pi package:

- the `pi-package` keyword,
- a `pi.extensions` entry that points at the extension module,
- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and
  `@earendil-works/pi-tui` in `peerDependencies` with a `*` range, because pi
  supplies them at run time and a second copy would break module identity,
- `@getstandards/core` in `dependencies`, because the package mechanism runs
  `npm install`.

pi loads TypeScript extensions through jiti, so the package ships its sources
and needs no build step.

A user installs it with:

| Command | Effect |
| --- | --- |
| `pi install npm:@getstandards/pi` | User-level install. |
| `pi install -l npm:@getstandards/pi` | Project-level install, written to `.pi/settings.json`. A committed project setting installs the extension for every teammate on startup, after project trust. |
| `pi -e npm:@getstandards/pi` | One run, without installing. |

A loose extension file in `~/.pi/agent/extensions/` or `.pi/extensions/` cannot
carry dependencies, so it is not a supported install path.

## Command

The extension registers one command, `/standards`.

`/standards` with no argument reviews the default change scope, `working-tree`,
as [Standards command line](./cli.md) defines it.

Arguments pass through to the same scope and filter surface the command line
defines. The extension MUST NOT invent its own scope selection or filter.

| Argument | Meaning |
| --- | --- |
| `<path>` | A target: a repository-relative file or directory that limits the review. |
| `--base <revision>` | Replace the default base revision. |
| `--range <base>..<head>` | Review two commits. |
| `--staged` | Review the index against `HEAD`. |
| `--all` | Review every file: a full review. |
| `--rule <id>` | Limit the rule set to one rule. |
| `--folder <folder>` | Limit the rule set to one mapped folder. |
| `--model <reference>` | Select the model of both agent steps. |
| `--evaluation-model <reference>` | Select the evaluation step model. |
| `--verification-model <reference>` | Select the verification step model. |

An option value follows the option or an `=`. An unknown option MUST fail with
a diagnostic instead of becoming a target: a mistyped option that reviewed a
non-existent path would report a compliant review that checked nothing.

`--rule` and `--folder` MUST NOT be given together.

## Running a review

The extension:

1. Reads the settings file, as [Standards settings](./settings.md) defines it.
2. Resolves the change scope with the core.
3. Resolves the rules with the core, through the same persistent source cache
   the command line uses, then applies the rule set filter.
4. Runs the review with a models runtime built over pi's model registry.

While the review runs, the extension renders a progress panel. In interactive
mode the panel shows the running phase (resolving, planning, evaluating, or
verifying), a proportional bar of finished agent invocations, the elapsed time,
and the key that cancels. Cancelling aborts the review through the
`AbortSignal` the core accepts, so a cancelled review stops spending tokens.

Outside interactive mode there is no terminal to draw in, so the review runs
without a panel and without a cancel path.

## Model selection

The review keeps the model selection that [Standards review](./review.md)
defines, resolved through pi's registry:

1. When a `/standards` option, a `STANDARDS_*` environment variable, or a
   settings field selects a model, the extension resolves that model through
   pi's registry and checks that pi has configured authentication for it. This
   keeps results consistent with CI.
2. Otherwise the review runs on pi's active model, the model the user already
   selected in pi.

With rule 2 a review inside pi can run on a model that differs from the models
CI uses. This is a deliberate trade: zero setup over strict parity. A team that
wants parity sets the model in settings.

## Models runtime adapter

The extension adapts pi's `ModelRegistry` to the `ReviewModels` interface of
[Standards core library](./library.md):

| `ReviewModels` call | pi registry call |
| --- | --- |
| `getProviders` | The distinct providers of `getAll()`. |
| `checkAuth` | `hasConfiguredAuth` and `isUsingOAuth` on the first model of the provider. |
| `getModel` | `find` |
| `completeSimple` | `complete` |

Every model call goes through `complete`, so the review uses pi's resolved
authentication. The extension MUST NOT read a raw API key: the `complete` path
covers every call the pipeline makes.

pi resolves authentication per model, not per provider, so a provider check
reads the first model of that provider. An OAuth credential makes the review's
cost a list price estimate, as [Standards review](./review.md) defines.

## Reporting

The review produces one message, which serves both readers:

- Its content is the text the agent reads: the summary and, for every finding,
  its rule id, level, rule statement, path, lines, evidence, reason,
  suggestion, and suggested change. That is what an agent needs to fix it.
- Its details is the typed report, which a registered renderer draws in the
  transcript for the person.

One message instead of a separate summary and payload keeps the two readings of
one review from drifting apart.

The renderer draws the report with the user's active theme, never with fixed
colors. The collapsed report answers the question a reader has right after a
review: the conclusion, the blocking and warning counts, the cost, and for each
finding its level, location, rule id, rule statement, and reason. The expanded
report adds the evidence, the remediation advice, and the suggested change,
syntax-highlighted for the finding's file type.

A collapsed report lists at most five findings and says how many it held back,
with the key hint that expands it. No rendered line may be wider than the
viewport.

The message MUST NOT start an agent turn. A review spends tokens and the fixes
spend more, so the user decides when to ask for them. A compliant review still
delivers its message, so the agent knows the review ran and changes nothing.

Outside the interactive transcript no renderer runs, so the extension also
notifies the summary and one line per finding.

## Failure handling

- A review with blocking findings is a completed review, not an error.
- Every other failure renders as a diagnostic with its problem and its next
  action. The two expected cases are a missing entry file and a selected model
  without configured authentication in pi.
- A diagnostic's next action names `/standards`, not `standards review`: the
  user is inside pi.

## Version 1 exclusions

This version does not define:

- An automatic review on a pi event, such as turn end or pre-commit. A review
  spends model tokens; the user starts it.
- An agent-invocable review tool. It needs a spend policy first.
- A `/standards` variant that reports without entering the agent context.
- Any change to the GitHub Action surface.
