---
title: Export types with `export type`, never with a plain `export`
description: A plain `export` that re-exports a type breaks the Bun build.
status: stable
---

Bun does not accept a plain `export` that re-exports a type together with a
value, so a shared index or barrel file fails to build.

Split the statement: re-export types with `export type` and values with a
separate `export`.

```ts
// Good
export type { SkillReport } from "./types/index.js";
export { runSkill } from "./sdk/runner.js";

// Bad - fails in Bun
export { SkillReport, runSkill } from "./types/index.js";
```
