import { parseAndValidateYamlDocument } from "../utils/yaml.js";
import type { Lockfile } from "./lockfile-schema.js";
import { lockfileSchema } from "./lockfile-schema.js";

/** An error found while loading a Standards lock document. */
export class LockfileLoadError extends Error {
	public constructor(
		message: string,
		public readonly sourceName: string,
		public readonly yamlPath?: string,
	) {
		super(message);
		this.name = "LockfileLoadError";
	}
}

/** Parse and validate one Standards lock YAML document. */
export function loadLockfile(
	sourceText: string,
	sourceName = ".standards.lock",
): Lockfile {
	return parseAndValidateYamlDocument(
		sourceText,
		sourceName,
		lockfileSchema,
		(message, yamlPath) => new LockfileLoadError(message, sourceName, yamlPath),
	);
}
