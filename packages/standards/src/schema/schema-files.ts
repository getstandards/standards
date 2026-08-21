import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The canonical base URL for published version 1 JSON Schema files. */
export const schemaBaseUrl = "https://getstandards.dev/schemas/v1/";

/** The JSON Schema files that ship with Standards. */
export const schemaTargets = ["config", "lock"] as const;

/** A JSON Schema file that ships with Standards. */
export type SchemaTarget = (typeof schemaTargets)[number];

/** The JSON Schema file names that ship with Standards. */
export const SCHEMA_FILE_NAMES: Record<SchemaTarget, string> = {
	config: "standards.schema.json",
	lock: "standards-lock.schema.json",
};

/** The canonical published URL of a bundled JSON Schema file. */
export function schemaUrl(target: SchemaTarget): string {
	return `${schemaBaseUrl}${SCHEMA_FILE_NAMES[target]}`;
}

/** The absolute filesystem path to a bundled JSON Schema file. */
export function schemaFilePath(target: SchemaTarget): string {
	return fileURLToPath(
		new URL(`../../schemas/v1/${SCHEMA_FILE_NAMES[target]}`, import.meta.url),
	);
}

/** Read a bundled JSON Schema file as text. */
export function readSchemaFile(target: SchemaTarget): Promise<string> {
	return readFile(schemaFilePath(target), "utf8");
}
