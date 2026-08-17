import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfigurationLoadError, loadConfiguration } from "./loader.js";

/** Build a minimal configuration that contains one applicability glob. */
function createConfigurationWithGlob(glob: string): string {
	return `
version: 1
rules:
  - id: test.rule
    level: MUST
    description: Test rule.
    rationale: Test rationale.
    applies_to:
      include:
        - ${JSON.stringify(glob)}
`;
}

describe("loadConfiguration", () => {
	it("parses the complete configuration example", () => {
		const configuration = loadConfiguration(`
---
version: 1
name: payments-service
description: Standards for the payments service.
extends:
  - path: .standards/typescript.yml
  - git:
      repository: https://github.com/acme/engineering-standards.git
      revision:
        tag: v2.1.0
      path: rules/security.yml
rules:
  - id: payments.no-floating-point-money
    level: MUST NOT
    description: Monetary values must not use floating-point types.
    rationale: Floating-point rounding can produce incorrect payment amounts.
    applies_to:
      include:
        - src/**/*.{ts,tsx}
      exclude:
        - src/**/*.test.ts
    guidance: Use the Money value object.
    references:
      - https://engineering.example.com/decisions/money-values
`);

		assert.equal(configuration.name, "payments-service");
		assert.equal(configuration.extends.length, 2);
		assert.equal(configuration.rules[0]?.level, "MUST NOT");
	});

	it("adds empty extension and rule lists to a minimal configuration", () => {
		assert.deepEqual(loadConfiguration("version: 1\n"), {
			version: 1,
			extends: [],
			rules: [],
		});
	});

	it("accepts anchors within one document", () => {
		const configuration = loadConfiguration(`
version: 1
rules:
  - id: test.first
    level: SHOULD
    description: Test rule.
    rationale: Test rationale.
    applies_to:
      include: &paths
        - src/**/*.ts
      exclude: *paths
`);

		assert.deepEqual(configuration.rules[0]?.applies_to?.exclude, [
			"src/**/*.ts",
		]);
	});

	it("rejects an unrecognized field with its YAML path", () => {
		assert.throws(
			() => loadConfiguration("version: 1\nextra: true\n", "rules.yml"),
			/rules\.yml:extra: Unrecognized key: "extra"/,
		);
	});

	it("rejects duplicate YAML mapping keys", () => {
		assert.throws(
			() => loadConfiguration("version: 1\nversion: 1\n"),
			ConfigurationLoadError,
		);
	});

	it("rejects more than one YAML document", () => {
		assert.throws(
			() => loadConfiguration("---\nversion: 1\n---\nversion: 1\n"),
			/Expected one YAML document, but found 2\./,
		);
	});

	it("rejects duplicate rule identifiers", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 1
rules:
  - id: test.rule
    level: MUST
    description: First.
    rationale: Test.
  - id: test.rule
    level: SHOULD
    description: Second.
    rationale: Test.
`),
			/\.standards\.yml:rules\[1\]\.id/,
		);
	});

	it("rejects invalid globs", () => {
		const invalidGlobs = [
			"/src/**/*.ts",
			"../src/**/*.ts",
			"src/./file.ts",
			"src\\file.ts",
			"src/**file.ts",
			"src/[abc.ts",
			"src/[a--z].ts",
			"src/{ts}.file",
			"src/{[ts,tsx}.file",
			"src//file.ts",
		];

		for (const glob of invalidGlobs) {
			assert.throws(
				() => loadConfiguration(createConfigurationWithGlob(glob)),
				/repository-relative glob/,
				glob,
			);
		}
	});

	it("rejects invalid branch names", () => {
		const invalidBranches = [
			"refs/heads/main",
			"-main",
			"feature..main",
			"feature main",
			"feature@{one",
			"feature.lock/main",
		];

		for (const branch of invalidBranches) {
			assert.throws(
				() =>
					loadConfiguration(`
version: 1
extends:
  - git:
      repository: https://github.com/acme/rules.git
      revision:
        branch: ${JSON.stringify(branch)}
      path: rules.yml
`),
				ConfigurationLoadError,
				branch,
			);
		}
	});

	it("rejects invalid repository URLs", () => {
		const invalidRepositories = [
			"http://github.com/acme/rules.git",
			"HTTPS://github.com/acme/rules.git",
			"https://user:password@github.com/acme/rules.git",
		];

		for (const repository of invalidRepositories) {
			assert.throws(
				() =>
					loadConfiguration(`
version: 1
extends:
  - git:
      repository: ${repository}
      revision:
        tag: v1
      path: rules.yml
`),
				ConfigurationLoadError,
				repository,
			);
		}
	});
});
