import { parseAllDocuments } from "yaml";
import type { z } from "zod/v4";
import { errorMessage } from "./errors.js";

/** A value produced by the YAML 1.2 core schema. */
export type YamlValue =
	| string
	| number
	| boolean
	| null
	| YamlValue[]
	| { [key: string]: YamlValue };

/** An error found while decoding one YAML document. */
export class YamlDocumentError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "YamlDocumentError";
	}
}

/**
 * Parse one YAML document and reject syntax errors and duplicate mapping keys.
 */
export function parseSingleYamlDocument(sourceText: string): YamlValue {
	const documents = parseAllDocuments(sourceText, {
		uniqueKeys: true,
		version: "1.2",
	});

	const document = documents[0];
	if (documents.length !== 1 || document === undefined) {
		throw new YamlDocumentError(
			`Expected one YAML document, but found ${documents.length}.`,
		);
	}

	const documentError = document.errors[0];
	if (documentError !== undefined) {
		throw new YamlDocumentError(documentError.message);
	}

	return document.toJS({ maxAliasCount: 100 });
}

/** Create a parser-specific error for a source and optional YAML path. */
export type YamlValidationErrorFactory = (
	message: string,
	yamlPath?: string,
) => Error;

/** Convert a Zod issue path to the YAML path format used by diagnostics. */
function formatYamlPath(path: PropertyKey[]): string {
	let yamlPath = "";
	for (const part of path) {
		if (typeof part === "number") {
			yamlPath += `[${part}]`;
			continue;
		}

		const propertyName = String(part);
		yamlPath += yamlPath === "" ? propertyName : `.${propertyName}`;
	}
	return yamlPath;
}

/** Parse one YAML document and validate it with the supplied Zod schema. */
export function parseAndValidateYamlDocument<Output>(
	sourceText: string,
	sourceName: string,
	schema: z.ZodType<Output>,
	createError: YamlValidationErrorFactory,
): Output {
	let input: YamlValue;
	try {
		input = parseSingleYamlDocument(sourceText);
	} catch (error) {
		throw createError(`${sourceName}: ${errorMessage(error)}`);
	}

	const result = schema.safeParse(input);
	if (result.success) {
		return result.data;
	}

	const issue = result.error.issues[0];
	if (issue === undefined) {
		throw createError(`${sourceName}: Invalid document.`);
	}

	const issuePath = [...issue.path];
	if (issue.code === "unrecognized_keys") {
		const unrecognizedKey = issue.keys[0];
		if (unrecognizedKey !== undefined) {
			issuePath.push(unrecognizedKey);
		}
	}

	const yamlPath = formatYamlPath(issuePath);
	const location = yamlPath === "" ? sourceName : `${sourceName}:${yamlPath}`;
	throw createError(
		`${location}: ${issue.message}`,
		yamlPath === "" ? undefined : yamlPath,
	);
}
