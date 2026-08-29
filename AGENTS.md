# Agent Instructions

## Core Principles

- Use the words in `TERMINOLOGY.md`. Do not invent synonyms, overloaded terms, or long compound names when an existing term fits.
- This is TypeScript/JavaScript, not Java. Prefer functions, plain objects, simple types, and small modules. Avoid class hierarchies, manager/factory names, and interface layers unless they solve a real problem.
- Optimize for the next maintainer. Choose the smallest design that solves the proven problem, keep complexity local, and avoid speculative abstractions, configuration, extension points, and wrappers.
- Write docs, specs, and explanations in ASD-STE100 English. Use common words, active voice, short sentences, and one idea per sentence. Keep required terms from `TERMINOLOGY.md` and explain them when needed. Remove other jargon.

Use **pnpm**: `pnpm install`, `pnpm dev`, `pnpm test`.

## Packages

| Package | Holds |
| --- | --- |
| `packages/core` (`@getstandards/core`) | Resolution, the review pipeline, and their types. No credential code. Specified in `specs/library.md`. |
| `packages/standards` (`@getstandards/standards`) | The `standards` command line, the GitHub Action build, credentials, and terminal rendering. |
| `packages/pi` (`@getstandards/pi`) | The pi extension that registers `/standards`. Specified in `specs/pi.md`. |

Put pipeline behavior in the core, so every surface shares it. Keep
credentials, rendering, and exit statuses in the surface that owns them.
`@getstandards/core` is the supported surface; `@getstandards/core/internal`
exists for the command line and carries no compatibility promise.

## TypeScript Exports

Use `export type` for type-only exports. This is required for Bun compatibility:

```ts
// Good
export type { SkillReport } from "./types/index.js";
export { runSkill } from "./sdk/runner.js";

// Bad - fails in Bun
export { SkillReport, runSkill } from "./types/index.js";
```

## Testing

New functionality requires tests, but only tests that are functionally additive. Don't write tests for the sake of testing. A test should exist because it catches a real bug or verifies a meaningful behavior, not to hit a coverage number.

- Co-locate tests with source (`foo.ts` -> `foo.test.ts`)
- Prefer integration tests over unit tests
- Add regression tests for bugs
- Mock external services, use real-world fixtures

## Documentation

When changes affect CLI behavior, command interfaces, or user-facing semantics (flags, error messages, default behavior), update the relevant documentation in `specs/` and `--help` output. Code and docs ship together.
