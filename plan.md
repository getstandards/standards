# Plan: migrate to a pnpm monorepo

Goal: keep the published package as `@getstandards/standards`, add a documentation
website in the same repository, and auto-generate the JSON Schema files.
Model: the warden repository layout (root `action.yml`, packages under
`packages/`, apps under `apps/`, orchestration scripts at the root).

## Target layout

```
standards/
├── package.json              # private root, orchestration scripts only
├── pnpm-workspace.yaml       # workspace globs + existing allowBuilds
├── pnpm-lock.yaml            # single lockfile
├── action.yml                # unchanged, main: dist/action/index.js
├── AGENTS.md, TERMINOLOGY.md, specs/, .standards.yml, mise.toml, assets/
├── packages/
│   └── standards/            # @getstandards/standards
│       ├── package.json
│       ├── src/
│       ├── schemas/          # generated, committed
│       ├── scripts/
│       ├── tsconfig.json
│       └── tsconfig.build.json
└── apps/
    └── docs/                 # private "standards-docs", Astro + Starlight
```

Rules:

- `action.yml` stays at the repo root. GitHub resolves `runs.main` from the
  repo root, so the action bundle must land in the root `dist/action/`.
- `specs/` stays at the root. The docs app reads from it later.
- The docs app is private and never publishes to npm.

## Step 1: move the package

```
mkdir -p packages/standards
git mv src schemas scripts tsconfig.json tsconfig.build.json package.json packages/standards/
```

Move everything in one step so all relative paths inside the package stay
correct. `src/schema/schema-files.ts` resolves `../../schemas/v1/` relative to
the compiled module; this path does not change when the whole package moves.

## Step 2: update `packages/standards/package.json`

- Rename: `"name": "@getstandards/standards"`.
- Keep `"bin": { "standards": "./dist/cli/index.js" }`. The command name does
  not change.
- Add `"publishConfig": { "access": "public" }`. Scoped packages default to
  restricted on npm.
- Add schema exports:

```json
"exports": {
  ".": "./dist/cli/index.js",
  "./schemas/v1/standards.schema.json": "./schemas/v1/standards.schema.json",
  "./schemas/v1/standards-lock.schema.json": "./schemas/v1/standards-lock.schema.json",
  "./package.json": "./package.json"
}
```

(Adjust the `"."` entry to the real library entry point if one exists; today
the package only ships a bin, so a root export is optional.)

- Add the generation script (see step 6):

```json
"generate:schemas": "tsx scripts/generate-schemas.ts"
```

- Keep `"files": ["dist", "schemas"]`.

## Step 3: redirect the action bundle to the repo root

In `packages/standards/scripts/build-action.mjs`, change:

```js
outfile: "dist/action/index.js",
```

to:

```js
outfile: "../../dist/action/index.js",
```

The script runs with the package directory as the working directory
(`pnpm --filter @getstandards/standards build:action`), so the relative path
resolves to the repo root. `action.yml` needs no change.

## Step 4: create the root `package.json`

```json
{
  "name": "standards-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.20.0",
  "engines": { "node": "^24.11.0", "pnpm": "^11.0.0" },
  "scripts": {
    "build": "pnpm --filter @getstandards/standards build",
    "build:action": "pnpm --filter @getstandards/standards build:action",
    "check": "pnpm -r check",
    "test": "pnpm -r test",
    "generate:schemas": "pnpm --filter @getstandards/standards generate:schemas",
    "docs": "pnpm --filter standards-docs dev",
    "docs:build": "pnpm --filter standards-docs build"
  }
}
```

Move shared devDependencies (`typescript`, `vitest`, `@biomejs/biome`,
`@types/node`, `tsx`) to the root if you want one version for all packages.
This is optional; per-package devDependencies also work.

## Step 5: update `pnpm-workspace.yaml`

Keep the existing `allowBuilds` block (pnpm 10+ reads it from this file) and
add the workspace globs:

```yaml
packages:
  - packages/*
  - apps/*

allowBuilds:
  "@google/genai": false
  esbuild: true
  protobufjs: false
```

## Step 6: auto-generate the JSON Schemas

Source of truth: the Zod schemas in `src/config/configuration-schema.ts` and
`src/lockfile/lockfile-schema.ts`. Zod 4 provides `z.toJSONSchema()`.

1. Create `packages/standards/scripts/generate-schemas.ts`:
   - Import both Zod schemas.
   - Call `z.toJSONSchema(schema, { unrepresentable: "any", io: "input" })`
     or similar options so Zod refinements are dropped, not fatal. The JSON
     Schemas are structural only; the drift test already documents this.
   - Set `$id` from `schemaBaseUrl` in `src/schema/schema-files.ts`
     (`https://getstandards.dev/schemas/v1/` + file name).
   - Write to `schemas/v1/standards.schema.json` and
     `schemas/v1/standards-lock.schema.json` with stable formatting
     (2-space indent, trailing newline).
2. Compare the generator output with the committed hand-written files. Fix the
   generator options until the output is structurally equivalent. Accept
   harmless formatting or ordering differences by regenerating and committing.
3. Keep the generated files committed. The npm package and the website must
   not need a build step to read them.
4. Add a freshness test (replace or extend `schema-drift.test.ts`): run the
   generator in memory and compare with the committed file content. The test
   fails when someone changes a Zod schema and forgets to regenerate.
   Keep the fixture-based drift test if it still adds coverage the freshness
   test does not (it validates real documents through both validators).

## Step 7: scaffold the docs app

```
pnpm create astro@latest apps/docs -- --template starlight --no-install --no-git
```

Then in `apps/docs/package.json`:

- `"name": "standards-docs"`, `"private": true`.
- Add `"@getstandards/standards": "workspace:*"`.

Serve the schemas at the canonical URLs:

- Add a prebuild step (or a small Astro integration) that copies
  `node_modules/@getstandards/standards/schemas/v1/*.json` into
  `apps/docs/public/schemas/v1/`.
- Result: `https://getstandards.dev/schemas/v1/standards.schema.json` resolves,
  which is the URL `schemaBaseUrl` already promises.

Content plan (later, not part of the migration): generate or copy Starlight
pages from `specs/*.md`.

## Step 8: install and verify

```
pnpm install
pnpm generate:schemas   # then: git diff --exit-code packages/standards/schemas
pnpm check
pnpm test
pnpm build              # confirm dist/action/index.js exists at the repo root
pnpm docs:build
```

Also run the CLI once from the built output to confirm the bin path and the
schema file resolution still work:

```
node packages/standards/dist/cli/index.js --help
```

## Step 9: cleanup

- Replace `.gitignore`. The current file is copied from the pnpm repository
  and contains rules that do not apply here (`pnpr/`, Verdaccio, NAPI
  artifacts). A small file is enough: `node_modules`, `dist`, `coverage`,
  `*.log`, `.DS_Store`, `.astro`, `tsconfig.tsbuildinfo`.
- Update `README.md` paths and any install or usage examples that reference
  the old package name `standards`.
- Update `specs/` where they describe the package name or repository layout.

## Open items

- **Action distribution.** `dist/` is gitignored but `action.yml` points to
  `dist/action/index.js`, and the repo has no `.github/` workflows. The
  release process for the action (whatever commits or attaches `dist` on a
  tag) must run `pnpm build:action` from the new layout. Define this process
  before the first post-migration release.
- **Docs deployment.** Choose a host (warden uses Vercel with a `vercel.json`
  inside the docs package). Point `getstandards.dev` at it so the schema URLs
  become real.
- **npm publish.** The first publish of `@getstandards/standards` is a new
  package name. Decide whether to deprecate or keep any earlier `standards`
  package name on npm.
