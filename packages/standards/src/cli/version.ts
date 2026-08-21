import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const packageManifest = require("../../package.json") as { version: string };

/** The current Standards application version (specs/cli.md). */
export const VERSION: string = packageManifest.version;
