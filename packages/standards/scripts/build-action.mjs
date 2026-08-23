// Bundle the GitHub Action entry with esbuild. ncc cannot bundle the pi AI
// SDK: the SDK loads Node built-ins through computed dynamic imports, which
// webpack rewrites into rejecting stubs that crash the bundle at startup.
// esbuild keeps a dynamic `import()` expression as-is, so Node resolves the
// built-ins at run time.
import { build } from "esbuild";
import { statSync } from "node:fs";

// The bundle embeds every provider SDK the action can select, so it is
// several MiB by design. esbuild prints a warning sign on any output over
// 1 MiB with a hard-coded threshold, so print our own summary and warn only
// when the bundle grows well past its current minified size.
const BUNDLE_SIZE_BUDGET = 4 * 1024 * 1024;

await build({
	entryPoints: ["src/action/action-main.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	minify: true,
	outfile: "../../dist/action/index.js",
	// Bundled CommonJS dependencies call `require`, which an ES module scope
	// does not define.
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
	},
	logLevel: "warning",
});

const bundlePath = "../../dist/action/index.js";
const size = statSync(bundlePath).size;
console.log(`  ${bundlePath}  ${(size / 1024 / 1024).toFixed(1)}mb minified`);
if (size > BUNDLE_SIZE_BUDGET) {
	const budget = BUNDLE_SIZE_BUDGET / 1024 / 1024;
	console.warn(`⚠️  bundle exceeds ${budget} MiB; check for a new heavy dependency`);
}
