import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationResolutionError, loadRules } from "./rules-loader.js";

const temporaryDirectories: string[] = [];
const environmentRestorations: Array<() => void> = [];

/** Create a temporary directory. */
async function createTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-rules-"));
	temporaryDirectories.push(directory);
	return directory;
}

/** Write one file, creating its parent directories. */
async function writeRepositoryFile(
	repositoryRoot: string,
	relativePath: string,
	content: string,
): Promise<void> {
	const filePath = path.join(repositoryRoot, ...relativePath.split("/"));
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content);
}

/** A knowledge document with a title and a body. */
function document(title: string, extraFrontmatter = ""): string {
	return `---\ntitle: ${title}\n${extraFrontmatter}---\n\nBody of ${title}.\n`;
}

/** Create a consumer repository with one local knowledge source. */
async function createLocalConsumer(
	documents: Record<string, string>,
	configuration = `version: 2
sources:
  - path: ./knowledge
    folders:
      decisions: MUST
      practices: SHOULD
`,
): Promise<string> {
	const repositoryRoot = await createTemporaryDirectory();
	await writeRepositoryFile(repositoryRoot, ".standards.yml", configuration);
	for (const folder of ["decisions", "practices"]) {
		await mkdir(path.join(repositoryRoot, "knowledge", folder), {
			recursive: true,
		});
	}
	for (const [relativePath, content] of Object.entries(documents)) {
		await writeRepositoryFile(
			repositoryRoot,
			`knowledge/${relativePath}`,
			content,
		);
	}
	return repositoryRoot;
}

/** Run a Git command in a repository. */
function runGit(repositoryRoot: string, arguments_: string[]): string {
	return execFileSync("git", arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim();
}

/** Configure Git to rewrite one HTTPS test URL to a local repository. */
function configureGitUrlRewrite(
	repository: string,
	localRepositoryRoot: string,
): void {
	const configIndex = Number(process.env.GIT_CONFIG_COUNT ?? "0");
	const values = new Map<string, string>([
		["GIT_CONFIG_COUNT", String(configIndex + 1)],
		[
			`GIT_CONFIG_KEY_${configIndex}`,
			`url.file://${localRepositoryRoot}/.insteadOf`,
		],
		[`GIT_CONFIG_VALUE_${configIndex}`, repository],
		[
			"GIT_ALLOW_PROTOCOL",
			process.env.GIT_ALLOW_PROTOCOL === undefined
				? "file"
				: `file:${process.env.GIT_ALLOW_PROTOCOL}`,
		],
	]);
	const previousValues = new Map<string, string | undefined>();
	for (const [name, value] of values) {
		previousValues.set(name, process.env[name]);
		process.env[name] = value;
	}
	environmentRestorations.push(() => {
		for (const [name, value] of previousValues) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
	});
}

/** Create a committed Git repository that holds one knowledge bundle. */
async function createGitKnowledgeRepository(
	documents: Record<string, string>,
): Promise<{ repositoryRoot: string; commit: string }> {
	const repositoryRoot = await createTemporaryDirectory();
	runGit(repositoryRoot, ["init", "--initial-branch=main"]);
	runGit(repositoryRoot, ["config", "user.name", "Standards Test"]);
	runGit(repositoryRoot, ["config", "user.email", "standards@example.com"]);
	runGit(repositoryRoot, ["config", "commit.gpgsign", "false"]);
	for (const [relativePath, content] of Object.entries(documents)) {
		await writeRepositoryFile(repositoryRoot, relativePath, content);
	}
	runGit(repositoryRoot, ["add", "."]);
	runGit(repositoryRoot, ["commit", "--quiet", "--message", "Add knowledge"]);
	return {
		repositoryRoot,
		commit: runGit(repositoryRoot, ["rev-parse", "HEAD"]),
	};
}

afterEach(async () => {
	for (const restoreEnvironment of environmentRestorations
		.splice(0)
		.reverse()) {
		restoreEnvironment();
	}
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("loadRules", () => {
	it("loads rules from mapped folders with derived ids and levels", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/2026-08-25-llm-calls-use-llm-service.md": document(
				"LLM calls go through the LLM service",
			),
			"practices/llm/prompt-caching.md": document("Use prompt caching"),
		});

		const { rules, gitSources, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(gitSources, []);
		assert.deepEqual(warnings, []);
		assert.deepEqual(
			rules.map(({ id, level, title }) => ({ id, level, title })),
			[
				{
					id: "2026-08-25-llm-calls-use-llm-service",
					level: "MUST",
					title: "LLM calls go through the LLM service",
				},
				{
					id: "llm.prompt-caching",
					level: "SHOULD",
					title: "Use prompt caching",
				},
			],
		);
		assert.equal(rules[1]?.body, "Body of Use prompt caching.");
	});

	it("carries only the reduced runtime rule fields", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/plain.md": document("Plain"),
		});

		const { rules } = await loadRules(repositoryRoot);

		assert.deepEqual(Object.keys(rules[0] ?? {}).sort(), [
			"body",
			"id",
			"level",
			"title",
		]);
	});

	it("keeps an absent description absent", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/plain.md": document("Plain"),
			"decisions/summarized.md": document(
				"Summarized",
				"description: One line.\n",
			),
		});

		const { rules } = await loadRules(repositoryRoot);
		const byId = new Map(rules.map((rule) => [rule.id, rule]));

		assert.equal(Object.hasOwn(byId.get("plain") ?? {}, "description"), false);
		assert.equal(byId.get("summarized")?.description, "One line.");
	});

	it("defaults the title to the file name slug", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/no-float-money.md": "---\n---\nNo floats.\n",
		});

		const { rules } = await loadRules(repositoryRoot);

		assert.equal(rules[0]?.title, "no-float-money");
	});

	it("discovers index.md when the configuration does not exclude it", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/index.md": document("Index rule"),
			"practices/llm/index.md": document("LLM index"),
		});

		const { rules } = await loadRules(repositoryRoot);

		assert.deepEqual(rules.map(({ id }) => id).sort(), ["index", "llm.index"]);
	});

	it("applies document include and exclude filters", async () => {
		const repositoryRoot = await createLocalConsumer(
			{
				"guides/active/keep.md": document("Keep"),
				"guides/templates/skip.md": document("Skip"),
				"guides/draft-notes.txt": "not markdown",
			},
			`version: 2
sources:
  - path: ./knowledge
    folders:
      guides:
        level: SHOULD
        documents:
          include:
            - active/**/*.md
          exclude:
            - "**/skip.md"
`,
		);

		const { rules, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(warnings, []);
		assert.deepEqual(
			rules.map(({ id }) => id),
			["active.keep"],
		);
	});

	it("intersects folder-level and document-level applicability", async () => {
		const repositoryRoot = await createLocalConsumer(
			{
				"decisions/scoped.md": document(
					"Scoped",
					"applies_to:\n  exclude:\n    - src/**/*.test.ts\n",
				),
			},
			`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions:
        level: MUST
        applies_to:
          include:
            - src/**
`,
		);

		const { rules } = await loadRules(repositoryRoot);

		assert.deepEqual(rules[0]?.applies_to, {
			include: ["src/**"],
			exclude: ["src/**/*.test.ts"],
		});
	});

	it("adds the id prefix to every derived id", async () => {
		const repositoryRoot = await createLocalConsumer(
			{
				"practices/api/pagination.md": document("Pagination"),
			},
			`version: 2
sources:
  - path: ./knowledge
    id_prefix: platform
    folders:
      practices: SHOULD
`,
		);

		const { rules } = await loadRules(repositoryRoot);

		assert.equal(rules[0]?.id, "platform.api.pagination");
	});

	it("enforces only stable, accepted documents", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/draft.md": document("Draft", "status: draft\n"),
			"decisions/deprecated.md": document("Deprecated", "status: deprecated\n"),
			"decisions/proposed.md": document("Proposed", "adr_status: proposed\n"),
			"decisions/accepted.md": document("Accepted", "adr_status: accepted\n"),
			"decisions/plain.md": document("Plain"),
		});

		const { rules, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(warnings, []);
		assert.deepEqual(
			rules.map(({ id }) => id),
			["accepted", "plain"],
		);
	});

	it("skips an invalid document with a warning and keeps the run alive", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/good.md": document("Good"),
			"decisions/no-frontmatter.md": "# Just markdown\n",
			"decisions/bad-status.md": document("Bad", "status: published\n"),
		});

		const { rules, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(
			rules.map(({ id }) => id),
			["good"],
		);
		assert.deepEqual(warnings.map(({ document: name }) => name).sort(), [
			"knowledge/decisions/bad-status.md",
			"knowledge/decisions/no-frontmatter.md",
		]);
		assert.match(String(warnings[0]?.problem), /status|frontmatter/);
	});

	it("skips a document whose derived id breaks the id grammar", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/Bad_Name.md": document("Bad name"),
		});

		const { rules, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(rules, []);
		assert.match(String(warnings[0]?.problem), /does not match/i);
	});

	it("does not enforce a superseded document and needs no alias resolution", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/old.md": document(
				"Old",
				"status: deprecated\nsuperseded_by: new.md\n",
			),
			"decisions/new.md": document("New"),
			"decisions/dangling.md": document(
				"Dangling",
				"superseded_by: missing.md\n",
			),
		});

		const { rules, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(warnings, []);
		assert.deepEqual(
			rules.map(({ id }) => id),
			["new"],
		);
	});

	it("fails when a mapped folder does not exist in the bundle", async () => {
		const repositoryRoot = await createLocalConsumer({
			"decisions/rule.md": document("Rule"),
		});
		await rm(path.join(repositoryRoot, "knowledge", "practices"), {
			recursive: true,
			force: true,
		});

		await expect(loadRules(repositoryRoot)).rejects.toThrow(
			/Folder 'practices' does not exist in knowledge source 'knowledge'/,
		);
	});

	it("fails when the entry file is missing", async () => {
		const repositoryRoot = await createTemporaryDirectory();

		await expect(loadRules(repositoryRoot)).rejects.toThrow(
			ConfigurationResolutionError,
		);
	});

	it("fails when a local source path escapes the repository root", async () => {
		const repositoryRoot = await createTemporaryDirectory();
		await writeRepositoryFile(
			repositoryRoot,
			".standards.yml",
			`version: 2
sources:
  - path: ../outside
    folders:
      decisions: MUST
`,
		);

		await expect(loadRules(repositoryRoot)).rejects.toThrow(
			/escapes repository root/,
		);
	});

	it("rejects duplicate identities and names id_prefix as the fix", async () => {
		const repositoryRoot = await createLocalConsumer(
			{
				"decisions/shared.md": document("First"),
				"more/decisions/shared.md": document("Second"),
			},
			`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions: MUST
  - path: ./knowledge/more
    folders:
      decisions: SHOULD
`,
		);

		await expect(loadRules(repositoryRoot)).rejects.toThrow(
			/Rule ID 'shared' in 'knowledge\/more' duplicates the rule from 'knowledge'.*id_prefix/s,
		);
	});

	it("resolves a duplicate identity through id_prefix", async () => {
		const repositoryRoot = await createLocalConsumer(
			{
				"decisions/shared.md": document("First"),
				"more/decisions/shared.md": document("Second"),
			},
			`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions: MUST
  - path: ./knowledge/more
    id_prefix: more
    folders:
      decisions: SHOULD
`,
		);

		const { rules } = await loadRules(repositoryRoot);

		assert.deepEqual(rules.map(({ id }) => id).sort(), [
			"more.shared",
			"shared",
		]);
	});

	it("resolves a Git source branch to its current commit", async () => {
		const gitSource = await createGitKnowledgeRepository({
			"decisions/git-rule.md": document("Git rule"),
		});
		const repository = "https://example.test/knowledge";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const repositoryRoot = await createTemporaryDirectory();
		await writeRepositoryFile(
			repositoryRoot,
			".standards.yml",
			`version: 2
sources:
  - repository: ${repository}
    branch: main
    folders:
      decisions: MUST
`,
		);

		const { rules, gitSources, warnings } = await loadRules(repositoryRoot);

		assert.deepEqual(warnings, []);
		assert.deepEqual(gitSources, [
			{ repository, branch: "main", commit: gitSource.commit },
		]);
		assert.deepEqual(
			rules.map(({ id, level }) => ({ id, level })),
			[{ id: "git-rule", level: "MUST" }],
		);
	});

	it("resolves the default branch when a Git source has no branch", async () => {
		const gitSource = await createGitKnowledgeRepository({
			"decisions/git-rule.md": document("Git rule"),
		});
		const repository = "https://example.test/default-knowledge";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const repositoryRoot = await createTemporaryDirectory();
		await writeRepositoryFile(
			repositoryRoot,
			".standards.yml",
			`version: 2
sources:
  - repository: ${repository}
    folders:
      decisions: SHOULD
`,
		);

		const { rules, gitSources } = await loadRules(repositoryRoot);

		assert.deepEqual(gitSources, [
			{ repository, branch: "main", commit: gitSource.commit },
		]);
		assert.equal(rules[0]?.level, "SHOULD");
	});

	it("fails when a Git source branch does not exist", async () => {
		const gitSource = await createGitKnowledgeRepository({
			"decisions/git-rule.md": document("Git rule"),
		});
		const repository = "https://example.test/missing-branch";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const repositoryRoot = await createTemporaryDirectory();
		await writeRepositoryFile(
			repositoryRoot,
			".standards.yml",
			`version: 2
sources:
  - repository: ${repository}
    branch: missing
    folders:
      decisions: MUST
`,
		);

		await expect(loadRules(repositoryRoot)).rejects.toThrow(
			/Branch 'missing' does not exist/,
		);
	});
});
