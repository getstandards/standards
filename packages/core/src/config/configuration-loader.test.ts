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
sources:
  - path: knowledge
    folders:
      architecture: MUST
      engineering-guides:
        level: SHOULD
        documents:
          exclude:
            - templates/**
        applies_to:
          include:
            - src/**
  - repository: https://github.com/acme/shared-knowledge.git
    branch: main
    path: knowledge
    id_prefix: shared
    folders:
      reliability: MUST
`);

		assert.equal(configuration.sources.length, 2);
		assert.deepEqual(configuration.sources[0], {
			path: "knowledge",
			folders: [
				{ folder: "architecture", level: "MUST" },
				{
					folder: "engineering-guides",
					level: "SHOULD",
					documents: { exclude: ["templates/**"] },
					applies_to: [{ include: ["src/**"] }],
				},
			],
		});
		assert.deepEqual(configuration.sources[1], {
			repository: "https://github.com/acme/shared-knowledge.git",
			branch: "main",
			path: "knowledge",
			id_prefix: "shared",
			folders: [{ folder: "reliability", level: "MUST" }],
		});
	});

	it("normalizes the list form of applies_to", () => {
		const configuration = loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders:
      practices:
        level: MUST
        applies_to:
          - documents: clickhouse/**
            include:
              - apps/analytics/**
          - documents:
              - tidb/**
              - mysql/**
            exclude:
              - "**/*.md"
          - include:
              - src/**
`);

		assert.deepEqual(configuration.sources[0]?.folders[0]?.applies_to, [
			{ documents: ["clickhouse/**"], include: ["apps/analytics/**"] },
			{ documents: ["tidb/**", "mysql/**"], exclude: ["**/*.md"] },
			{ include: ["src/**"] },
		]);
	});

	it("rejects an applies_to entry without include and exclude", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders:
      practices:
        level: MUST
        applies_to:
          - documents: clickhouse/**
`),
			ConfigurationLoadError,
		);
	});

	it("adds an empty source list to a minimal configuration", () => {
		assert.deepEqual(loadConfiguration("version: 2\n"), {
			version: 2,
			sources: [],
		});
	});

	it("normalizes the short folder mapping form to a level", () => {
		const configuration = loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders:
      decisions: MUST
`);

		assert.deepEqual(configuration.sources[0], {
			path: "knowledge",
			folders: [{ folder: "decisions", level: "MUST" }],
		});
	});

	it("accepts a Git source without a branch and with a path", () => {
		const configuration = loadConfiguration(`
version: 2
sources:
  - repository: https://github.com/example/engineering-knowledge
    path: bundles/backend
    folders:
      guides/clickhouse: SHOULD
`);

		const gitSource = configuration.sources[0];
		assert.ok(gitSource !== undefined && "repository" in gitSource);
		assert.equal(gitSource.branch, undefined);
		assert.equal(gitSource.path, "bundles/backend");
		assert.equal(gitSource.folders[0]?.folder, "guides/clickhouse");
	});

	it("accepts SSH repository URLs in ssh and scp form", () => {
		for (const repository of [
			"ssh://git@github.com/example/engineering-knowledge.git",
			"git@github.com:example/engineering-knowledge.git",
		]) {
			const configuration = loadConfiguration(`
version: 2
sources:
  - repository: ${JSON.stringify(repository)}
    folders:
      decisions: MUST
`);
			const gitSource = configuration.sources[0];
			assert.ok(gitSource !== undefined && "repository" in gitSource);
			assert.equal(gitSource.repository, repository);
		}
	});

	it("rejects configuration version 1", () => {
		assert.throws(
			() => loadConfiguration("version: 1\n"),
			ConfigurationLoadError,
		);
	});

	it("rejects a top-level name or description field", () => {
		assert.throws(
			() => loadConfiguration("version: 2\nname: payments\n"),
			/Unrecognized key/,
		);
		assert.throws(
			() => loadConfiguration("version: 2\ndescription: text\n"),
			/Unrecognized key/,
		);
	});

	it("rejects a source without a folders object", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: knowledge
`),
			ConfigurationLoadError,
		);
	});

	it("rejects an empty folders object", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders: {}
`),
			/at least one folder mapping/,
		);
	});

	it("rejects overlapping folders of the same source", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders:
      guides: MUST
      guides/clickhouse: SHOULD
`),
			/Folder 'guides\/clickhouse' overlaps folder 'guides'/,
		);
	});

	it("accepts the same folder in two different sources", () => {
		const configuration = loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders:
      decisions: MUST
  - path: more-knowledge
    folders:
      decisions: SHOULD
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
  - path: knowledge
    folders:
      ${JSON.stringify(folder)}: MUST
`),
				ConfigurationLoadError,
				folder,
			);
		}
	});

	it("rejects an invalid id prefix", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: knowledge
    id_prefix: "Bad Prefix"
    folders:
      decisions: MUST
`),
			ConfigurationLoadError,
		);
	});

	it("points at the exact field inside a source union failure", () => {
		assert.throws(
			() =>
				loadConfiguration(`
version: 2
sources:
  - path: knowledge
    folders:
      decisions:
        level: MUST
        documents:
          excluse:
            - llm/**/*.md
`),
			/sources\[0\]\.folders\.decisions\.documents\.excluse: Unrecognized key/,
		);
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
  - repository: https://github.com/acme/knowledge
    branch: ${JSON.stringify(branch)}
    folders:
      decisions: MUST
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
  - repository: ${JSON.stringify(repository)}
    folders:
      decisions: MUST
`),
				ConfigurationLoadError,
				repository,
			);
		}
	});
});
