import { readFile } from "node:fs/promises";
import { errorMessage, isMissingFileError } from "../utils/errors.js";
import { parseAndValidateYamlDocument } from "../utils/yaml.js";
import type { StandardsSettings } from "./settings-schema.js";
import { standardsSettingsSchema } from "./settings-schema.js";

/** An error found while reading or validating a Standards settings file. */
export class StandardsSettingsLoadError extends Error {
	public constructor(
		public readonly settingsPath: string,
		public readonly problem: string,
		public readonly yamlPath?: string,
	) {
		const location =
			yamlPath === undefined ? settingsPath : `${settingsPath}:${yamlPath}`;
		super(`Standards settings load failed at ${location}: ${problem}`);
		this.name = "StandardsSettingsLoadError";
	}
}

/** Parse and validate one Standards settings YAML document. */
export function loadStandardsSettings(
	sourceText: string,
	settingsPath = "settings.yml",
): StandardsSettings {
	return parseAndValidateYamlDocument(
		sourceText,
		settingsPath,
		standardsSettingsSchema,
		(message, yamlPath) => {
			const location =
				yamlPath === undefined
					? `${settingsPath}: `
					: `${settingsPath}:${yamlPath}: `;
			const problem = message.startsWith(location)
				? message.slice(location.length)
				: message;
			return new StandardsSettingsLoadError(settingsPath, problem, yamlPath);
		},
	);
}

/** Read and validate a Standards settings file, or return no settings when it is missing. */
export async function readStandardsSettingsFile(
	settingsPath: string,
): Promise<StandardsSettings | undefined> {
	let sourceText: string;
	try {
		sourceText = await readFile(settingsPath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw new StandardsSettingsLoadError(
			settingsPath,
			`Cannot read settings file: ${errorMessage(error)}`,
		);
	}

	return loadStandardsSettings(sourceText, settingsPath);
}
