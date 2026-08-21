// Bundle the GitHub Action entry with esbuild. ncc cannot bundle the pi AI
// SDK: the SDK loads Node built-ins through computed dynamic imports, which
// webpack rewrites into rejecting stubs that crash the bundle at startup.
// esbuild keeps a dynamic `import()` expression as-is, so Node resolves the
// built-ins at run time.
import { build } from "esbuild";

await build({
	entryPoints: ["src/action/action-main.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	outfile: "../../dist/action/index.js",
	// Bundled CommonJS dependencies call `require`, which an ES module scope
	// does not define.
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
	},
	logLevel: "info",
});
