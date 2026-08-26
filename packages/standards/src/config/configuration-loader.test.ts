import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	ConfigurationLoadError,
	loadConfiguration,
} from "./configuration-loader.js";

describe("loadConfiguration", () => {
	it("parses the complete configuration example", () => {
		const configuration = loadConfiguration(`
---
version: 2
name: payments-service
description: Standards for the payments service.
sources:
  - path: ./knowledge
    rules:
      - folder: decisions
        level: MUST
      - folder: practices
        level: SHOULD
  - git:
      repository: https://github.com/example/engineering-knowledge
      ref: main
    rules:
      - folder: decisions
        level: MUST
`);

		assert.equal(configuration.name, "payments-service");
		assert.equal(configuration.sources.length, 2);
		assert.deepEqual(configuration.sources[0], {
			path: "./knowledge",
			rules: [
				{ folder: "decisions", level: "MUST" },
				{ folder: "practices", level: "SHOULD" },
			],
		});
		const gitSource = configuration.sources[1];
		assert.ok(gitSource !== undefined && "git" in gitSource);
		assert.equal(gitSource.git.ref, "main");
	});

	it("adds an empty source list to a minimal configuration", () => {
		assert.deepEqual(loadConfiguration("version: 2\n"), {
			version: 2,
			sources: [],
		});
	});

	it("accepts a Git source without a ref and with a path", () => {
		const configuration = loadConfiguration(`
version: 2
sources:
  - git:
      repository: https://github.com/example/engineering-knowledge
      path: bundles/backend
    rules:
      - folder: guides/clickhouse
        level: SHOULD
`);

		const gitSource = configuration.sources[0];
		assert.ok(gitSource !== undefined && "git" in gitSource);
		assert.equal(gitSource.git.ref, undefined);
		assert.equal(gitSource.git.path, "bundles/backend");
		assert.equal(gitSource.rules[0]?.folder, "guides/clickhouse");
	});

	it("accepts SSH repository URLs in ssh and scp form", () => {
		for (const repository of [
			"ssh://git@github.com/example/engineering-knowledge.git",
			"git@github.com:example/engineering-knowledge.git",
		]) {
			const configuration = loadConfiguration(`
version: 2
sources:
  - git:
      repository: ${JSON.stringify(repository)}
    rules:
      - folder: decisions
        level: MUST
`);
			const gitSource = configuration.sources[0];
			assert.ok(gitSource !== undefined && "git" in gitSource);
			assert.equal(gitSource.git.repository, repository);
		}
	});

	it("rejects configuration version 1", () => {
		assert.throws(
			() => loadConfiguration("version: 1\n"),
			ConfigurationLoadError,
		);
	});

	it("rejects a source without a rules list", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: ./knowledge
`),
			ConfigurationLoadError,
		);
	});

	it("rejects overlapping folders of the same source", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: ./knowledge
    rules:
      - folder: guides
        level: MUST
      - folder: guides/clickhouse
        level: SHOULD
`),
			/sources\[0\]\.rules\[1\]\.folder: Folder 'guides\/clickhouse' overlaps rules\[0\]\.folder/,
		);
	});

	it("accepts the same folder in two different sources", () => {
		const configuration = loadConfiguration(`
version: 2
sources:
  - path: ./knowledge
    rules:
      - folder: decisions
        level: MUST
  - path: ./more-knowledge
    rules:
      - folder: decisions
        level: SHOULD
`);

		assert.equal(configuration.sources.length, 2);
	});

	it("rejects invalid folder paths", () => {
		const invalidFolders = [
			"/decisions",
			"../decisions",
			"decisions/",
			"a/./b",
		];

		for (const folder of invalidFolders) {
			assert.throws(
				() =>
					loadConfiguration(`
version: 2
sources:
  - path: ./knowledge
    rules:
      - folder: ${JSON.stringify(folder)}
        level: MUST
`),
				ConfigurationLoadError,
				folder,
			);
		}
	});

	it("rejects an unrecognized field with its YAML path", () => {
		assert.throws(
			() => loadConfiguration("version: 2\nextra: true\n", "rules.yml"),
			/rules\.yml:extra: Unrecognized key: "extra"/,
		);
	});

	it("rejects duplicate YAML mapping keys", () => {
		assert.throws(
			() => loadConfiguration("version: 2\nversion: 2\n"),
			ConfigurationLoadError,
		);
	});

	it("rejects more than one YAML document", () => {
		assert.throws(
			() => loadConfiguration("---\nversion: 2\n---\nversion: 2\n"),
			/Expected one YAML document, but found 2\./,
		);
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
version: 2
sources:
  - git:
      repository: https://github.com/acme/knowledge
      ref: ${JSON.stringify(branch)}
    rules:
      - folder: decisions
        level: MUST
`),
				ConfigurationLoadError,
				branch,
			);
		}
	});

	it("rejects invalid repository URLs", () => {
		const invalidRepositories = [
			"http://github.com/acme/knowledge.git",
			"HTTPS://github.com/acme/knowledge.git",
			"https://user:password@github.com/acme/knowledge.git",
			"github.com/acme/knowledge",
		];

		for (const repository of invalidRepositories) {
			assert.throws(
				() =>
					loadConfiguration(`
version: 2
sources:
  - git:
      repository: ${JSON.stringify(repository)}
    rules:
      - folder: decisions
        level: MUST
`),
				ConfigurationLoadError,
				repository,
			);
		}
	});
});
