# Agent Instructions

## Package Manager

Use **pnpm**: `pnpm install`, `pnpm build`, `pnpm test`

## Key Conventions

- TypeScript strict mode
- Zod for runtime validation
- ESM modules (`"type": "module"`)
- Vitest for testing

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
