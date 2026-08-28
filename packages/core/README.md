# @getstandards/core

The [Standards](https://github.com/getstandards/standards) core library:
resolution, the review pipeline, and their types.

Every Standards surface runs the same review through this package: the
`standards` command line, the GitHub Action, and the pi extension. The core
holds no credential code. Each surface supplies its own model access through the
`ReviewModels` interface.

## Use

```ts
import { loadRules, resolveChangeScope, runReview } from "@getstandards/core";

const resolution = await loadRules(repositoryRoot);
const scope = await resolveChangeScope(repositoryRoot, { base: "main" });
const report = await runReview({
	scope,
	workingDirectory: repositoryRoot,
	resolution,
	models, // your ReviewModels runtime
	environment: process.env,
	signal: controller.signal,
});
```

A review with blocking findings is a completed review: read
`report.conclusion`. Every other failure throws a typed error.

`@getstandards/core/internal` exists for the first-party command line and
carries no compatibility promise.

## Documentation

- [Library specification](https://github.com/getstandards/standards/blob/main/specs/library.md)
- [Review pipeline](https://github.com/getstandards/standards/blob/main/specs/review.md)
- [Configuration format](https://github.com/getstandards/standards/blob/main/specs/configuration.md)

MIT licensed.
