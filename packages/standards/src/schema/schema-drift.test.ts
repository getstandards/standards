import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { configurationSchema } from "../config/configuration-schema.js";
import { lockfileSchema } from "../lockfile/lockfile-schema.js";
import { readSchemaFile, type SchemaTarget } from "./schema-files.js";
import { generateSchemaJson } from "./schema-generation.js";

// The Zod schemas validate at runtime; the JSON Schemas ship for editors and
// external tools. This suite runs the same fixtures through both so structural
// drift between them fails the build. The JSON Schemas cannot express the
// semantic rules from specs/configuration.md, so fixtures marked semanticOnly
// are rejected by Zod but accepted by the JSON Schema on purpose.

interface Fixture {
	name: string;
	document: unknown;
	valid: boolean;
	semanticOnly?: boolean;
}

const COMMIT_A = "1".repeat(40);
const COMMIT_B = "2".repeat(40);

const validRule = {
	id: "example.rule",
	level: "SHOULD NOT",
	description: "Example rule.",
	rationale: "Example rationale.",
	applies_to: { include: ["**/*.sql"] },
	guidance: "Example guidance.",
	references: ["https://example.com"],
};

const configFixtures: Fixture[] = [
	{ name: "minimal document", document: { version: 1 }, valid: true },
	{
		name: "full document",
		document: {
			version: 1,
			name: "Example",
			description: "Example configuration.",
			extends: [
				{
					git: {
						repository: "https://github.com/owner/repo",
						revision: { branch: "main" },
						path: ".standards.yml",
					},
				},
			],
			rules: [validRule],
		},
		valid: true,
	},
	{ name: "wrong version", document: { version: 2 }, valid: false },
	{ name: "missing version", document: {}, valid: false },
	{
		name: "unknown top-level key",
		document: { version: 1, bogus: true },
		valid: false,
	},
	{
		name: "rule without rationale",
		document: {
			version: 1,
			rules: [{ id: "a.b", level: "MUST", description: "d" }],
		},
		valid: false,
	},
	{
		name: "rule with unknown key",
		document: { version: 1, rules: [{ ...validRule, bogus: true }] },
		valid: false,
	},
	{
		name: "unknown requirement level",
		document: {
			version: 1,
			rules: [{ ...validRule, level: "REQUIRED" }],
		},
		valid: false,
	},
	{
		name: "revision with two kinds",
		document: {
			version: 1,
			extends: [
				{
					git: {
						repository: "https://github.com/owner/repo",
						revision: { branch: "main", tag: "v1" },
						path: ".standards.yml",
					},
				},
			],
		},
		valid: false,
	},
	{
		name: "repository with credentials",
		document: {
			version: 1,
			extends: [
				{
					git: {
						repository: "https://user:pass@github.com/owner/repo",
						revision: { branch: "main" },
						path: ".standards.yml",
					},
				},
			],
		},
		valid: false,
	},
	{
		name: "duplicate rule id",
		document: { version: 1, rules: [validRule, validRule] },
		valid: false,
		semanticOnly: true,
	},
	{
		name: "invalid glob grammar",
		document: {
			version: 1,
			rules: [{ ...validRule, applies_to: { include: ["**foo"] } }],
		},
		valid: false,
		semanticOnly: true,
	},
	{
		name: "invalid branch grammar",
		document: {
			version: 1,
			extends: [
				{
					git: {
						repository: "https://github.com/owner/repo",
						revision: { branch: "feature..broken" },
						path: ".standards.yml",
					},
				},
			],
		},
		valid: false,
		semanticOnly: true,
	},
];

const lockFixtures: Fixture[] = [
	{ name: "empty sources", document: { version: 1, sources: [] }, valid: true },
	{
		name: "one source",
		document: {
			version: 1,
			sources: [
				{
					repository: "https://github.com/owner/repo",
					revision: { tag: "v1" },
					commit: COMMIT_A,
				},
			],
		},
		valid: true,
	},
	{
		name: "source without commit",
		document: {
			version: 1,
			sources: [
				{
					repository: "https://github.com/owner/repo",
					revision: { tag: "v1" },
				},
			],
		},
		valid: false,
	},
	{
		name: "commit revision in lock",
		document: {
			version: 1,
			sources: [
				{
					repository: "https://github.com/owner/repo",
					revision: { commit: COMMIT_A },
					commit: COMMIT_A,
				},
			],
		},
		valid: false,
	},
	{
		name: "duplicate mutable revision",
		document: {
			version: 1,
			sources: [
				{
					repository: "https://github.com/owner/repo",
					revision: { tag: "v1" },
					commit: COMMIT_A,
				},
				{
					repository: "https://github.com/owner/repo",
					revision: { tag: "v1" },
					commit: COMMIT_B,
				},
			],
		},
		valid: false,
		semanticOnly: true,
	},
];

async function compileValidators(): Promise<{
	config: ValidateFunction;
	lock: ValidateFunction;
}> {
	const ajv = new Ajv2020({ strict: false, allErrors: true });
	const configSchema = JSON.parse(await readSchemaFile("config"));
	const lockSchema = JSON.parse(await readSchemaFile("lock"));
	ajv.addSchema(configSchema);
	return {
		config: ajv.getSchema(configSchema.$id) as ValidateFunction,
		lock: ajv.compile(lockSchema),
	};
}

describe("schema drift", () => {
	const zodSchemas = { config: configurationSchema, lock: lockfileSchema };
	const fixtureSets: Record<SchemaTarget, Fixture[]> = {
		config: configFixtures,
		lock: lockFixtures,
	};

	for (const target of ["config", "lock"] as const) {
		describe(`${target} schema`, () => {
			for (const fixture of fixtureSets[target]) {
				it(`agrees on ${fixture.name}`, async () => {
					const { [target]: validate } = await compileValidators();
					const zodAccepts = zodSchemas[target].safeParse(
						fixture.document,
					).success;
					const jsonSchemaAccepts = validate(fixture.document) === true;

					expect(zodAccepts).toBe(fixture.valid);
					expect(jsonSchemaAccepts).toBe(
						fixture.semanticOnly ? true : fixture.valid,
					);
				});
			}
		});
	}

	describe("generated schema freshness", () => {
		for (const target of ["config", "lock"] as const) {
			it(`${target} schema is up to date`, async () => {
				const committed = JSON.parse(await readSchemaFile(target));
				expect(generateSchemaJson(target)).toEqual(committed);
			});
		}
	});
});
