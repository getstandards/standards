import { parseAndValidateYamlDocument } from "../utils/yaml.js";
import type { Configuration } from "./schema.js";
import { configurationSchema } from "./schema.js";

/** An error found while loading a Standards configuration document. */
export class ConfigurationLoadError extends Error {
	public constructor(
		message: string,
		public readonly sourceName: string,
		public readonly yamlPath?: string,
	) {
		super(message);
		this.name = "ConfigurationLoadError";
	}
}

/**
 * Parse and validate one Standards configuration YAML document.
 *
 * This function does not resolve entries from `extends`.
 */
export function loadConfiguration(
	sourceText: string,
	sourceName = ".standards.yml",
): Configuration {
	return parseAndValidateYamlDocument(
		sourceText,
		sourceName,
		configurationSchema,
		(message, yamlPath) =>
			new ConfigurationLoadError(message, sourceName, yamlPath),
	);
}
