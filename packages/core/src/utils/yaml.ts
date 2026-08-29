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

/** One flattened validation issue with its full path from the document root. */
interface FlatIssue {
	code: string;
	path: PropertyKey[];
	message: string;
	keys?: PropertyKey[];
}

/** The best issue of a set of sibling issues, with its depth and branch size. */
interface RankedIssue {
	issue: FlatIssue;
	depth: number;
	/** The number of issues in the union branch this issue came from. */
	count: number;
}

/**
 * Find the most specific issue among a set of sibling Zod issues.
 *
 * A `z.union` reports a generic "Invalid input" at the union's own path, with
 * the real problems nested per branch. This descends into each branch, then
 * keeps the deepest issue, so the diagnostic points at the field that is
 * actually wrong (for example a misspelled `documents` key) instead of the
 * source object. A depth tie prefers the branch with fewer issues, which is the
 * branch the input most closely matches.
 */
function rankIssues(
	issues: readonly UnknownIssue[],
	basePath: PropertyKey[],
): RankedIssue | undefined {
	let best: RankedIssue | undefined;
	for (const issue of issues) {
		const fullPath = [...basePath, ...issue.path];
		let candidate: RankedIssue | undefined;
		if (issue.code === "invalid_union" && Array.isArray(issue.errors)) {
			for (const branch of issue.errors) {
				const branchBest = rankIssues(branch, fullPath);
				if (branchBest === undefined) {
					continue;
				}
				const ranked: RankedIssue = { ...branchBest, count: branch.length };
				if (
					candidate === undefined ||
					ranked.depth > candidate.depth ||
					(ranked.depth === candidate.depth && ranked.count < candidate.count)
				) {
					candidate = ranked;
				}
			}
		} else {
			candidate = {
				issue: {
					code: issue.code,
					path: fullPath,
					message: issue.message,
					keys: issue.keys,
				},
				depth: fullPath.length,
				count: 1,
			};
		}
		if (
			candidate !== undefined &&
			(best === undefined || candidate.depth > best.depth)
		) {
			best = candidate;
		}
	}
	return best;
}

/** The Zod issue fields this module reads, across issue codes. */
interface UnknownIssue {
	code: string;
	path: PropertyKey[];
	message: string;
	keys?: PropertyKey[];
	errors?: UnknownIssue[][];
}

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

	const ranked = rankIssues(
		result.error.issues as unknown as UnknownIssue[],
		[],
	);
	if (ranked === undefined) {
		throw createError(`${sourceName}: Invalid document.`);
	}
	const issue = ranked.issue;

	const issuePath = [...issue.path];
	if (issue.code === "unrecognized_keys") {
		const unrecognizedKey = issue.keys?.[0];
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
