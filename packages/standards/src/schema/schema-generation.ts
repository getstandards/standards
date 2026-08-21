import { writeFile } from "node:fs/promises";
import { z } from "zod/v4";
import {
	configurationSchema,
	repositoryUrlSchema,
} from "../config/configuration-schema.js";
import { lockfileSchema } from "../lockfile/lockfile-schema.js";
import {
	SCHEMA_FILE_NAMES,
	type SchemaTarget,
	schemaBaseUrl,
	schemaFilePath,
} from "./schema-files.js";

/**
 * The Git repository URL pattern from repositoryUrlSchema superRefine. The
 * JSON Schemas are structural only: Zod refinements are dropped by
 * z.toJSONSchema, but the no-credentials rule is enforced in the committed
 * schemas as a pattern, so the generator restores it there.
 */
const REPOSITORY_URL_PATTERN = "^https://(?![^/]*@)";

/** The title and description attached to a generated schema document. */
const SCHEMA_DOCUMENTS: Record<
	SchemaTarget,
	{ title: string; description: string }
> = {
	config: {
		title: "Standards configuration",
		description: "Version 1 of the .standards.yml configuration format.",
	},
	lock: {
		title: "Standards lock file",
		description: "Version 1 of the .standards.lock format.",
	},
};

/** Generate the committed JSON Schema document for one target. */
export function generateSchemaJson(
	target: SchemaTarget,
): Record<string, unknown> {
	const sourceSchema =
		target === "config" ? configurationSchema : lockfileSchema;
	const schema = z.toJSONSchema(sourceSchema, {
		unrepresentable: "any",
		io: "input",
		override: ({ zodSchema, jsonSchema }) => {
			if (zodSchema === repositoryUrlSchema) {
				Object.assign(jsonSchema, { pattern: REPOSITORY_URL_PATTERN });
			}
		},
	}) as unknown as Record<string, unknown>;

	schema.$id = `${schemaBaseUrl}${SCHEMA_FILE_NAMES[target]}`;
	schema.title = SCHEMA_DOCUMENTS[target].title;
	schema.description = SCHEMA_DOCUMENTS[target].description;
	return schema;
}

/**
 * Write the generated JSON Schema documents to the committed schema
 * directory with stable formatting (2-space indent, trailing newline).
 */
export async function writeGeneratedSchemas(): Promise<void> {
	for (const target of ["config", "lock"] as const) {
		const contents = `${JSON.stringify(generateSchemaJson(target), null, 2)}\n`;
		await writeFile(schemaFilePath(target), contents);
	}
}
