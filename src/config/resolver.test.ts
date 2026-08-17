import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { ConfigurationResolutionError, loadRules } from "./resolver.js";

const RULE = `
  - id: RULE_ID
    level: MUST
    description: RULE_DESCRIPTION
    rationale: Test rationale.
`;
const temporaryDirectories: string[] = [];
const environmentRestorations: Array<() => void> = [];

/** Create one rule YAML fragment. */
function rule(id: string, description: string): string {
	return RULE.replace("RULE_ID", id).replace("RULE_DESCRIPTION", description);
}

/** Create a temporary repository directory. */
async function createRepository(): Promise<string> {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "standards-resolver-"),
	);
	temporaryDirectories.push(repositoryRoot);
	return repositoryRoot;
}

/** Run a Git command in a test repository. */
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

/** Create a committed Git repository that contains nested rule files. */
async function createGitRulesRepository(): Promise<{
	repositoryRoot: string;
	commit: string;
}> {
	const repositoryRoot = await createRepository();
	runGit(repositoryRoot, ["init", "--initial-branch=main"]);
	runGit(repositoryRoot, ["config", "user.name", "Standards Test"]);
	runGit(repositoryRoot, ["config", "user.email", "standards@example.com"]);
	await mkdir(path.join(repositoryRoot, "rules"));
	await writeFile(
		path.join(repositoryRoot, "rules", "base.yml"),
		`version: 1
extends:
  - path: nested.yml
rules:${rule("git.base", "Git base rule.")}`,
	);
	await writeFile(
		path.join(repositoryRoot, "rules", "nested.yml"),
		`version: 1
rules:${rule("git.nested", "Git nested rule.")}`,
	);
	runGit(repositoryRoot, ["add", "."]);
	runGit(repositoryRoot, ["commit", "--quiet", "--message", "Add rules"]);
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
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, {
				recursive: true,
				force: true,
			}),
		),
	);
});

describe("loadRules", () => {
	it("loads nested local rules in depth-first order and skips shared sources", async () => {
		const repositoryRoot = await createRepository();
		await mkdir(path.join(repositoryRoot, "rules", "nested"), {
			recursive: true,
		});
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - path: rules/backend.yml
  - path: rules/security.yml
rules:${rule("root.rule", "Root rule.")}`,
		);
		await writeFile(
			path.join(repositoryRoot, "rules", "backend.yml"),
			`version: 1
extends:
  - path: nested/shared.yml
rules:${rule("backend.rule", "Backend rule.")}`,
		);
		await writeFile(
			path.join(repositoryRoot, "rules", "security.yml"),
			`version: 1
extends:
  - path: nested/shared.yml
rules:${rule("security.rule", "Security rule.")}`,
		);
		await writeFile(
			path.join(repositoryRoot, "rules", "nested", "shared.yml"),
			`version: 1
rules:${rule("shared.rule", "Shared rule.")}`,
		);

		const rules = await loadRules(repositoryRoot);

		assert.deepEqual(
			rules.map(({ id }) => id),
			["shared.rule", "backend.rule", "security.rule", "root.rule"],
		);
	});

	it("rejects extension cycles with the complete cycle", async () => {
		const repositoryRoot = await createRepository();
		await mkdir(path.join(repositoryRoot, "rules"));
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			"version: 1\nextends:\n  - path: rules/base.yml\n",
		);
		await writeFile(
			path.join(repositoryRoot, "rules", "base.yml"),
			"version: 1\nextends:\n  - path: ../.standards.yml\n",
		);

		await assert.rejects(
			loadRules(repositoryRoot),
			/\.standards\.yml -> rules\/base\.yml -> \.standards\.yml/,
		);
	});

	it("rejects paths that escape the repository through a symbolic link", async () => {
		const repositoryRoot = await createRepository();
		const externalDirectory = await createRepository();
		const externalFile = path.join(externalDirectory, "external.yml");
		await writeFile(externalFile, "version: 1\n");
		await symlink(externalFile, path.join(repositoryRoot, "external.yml"));
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			"version: 1\nextends:\n  - path: external.yml\n",
		);

		await assert.rejects(
			loadRules(repositoryRoot),
			/resolves outside repository root/,
		);
	});

	it("rejects duplicate rule IDs from different sources", async () => {
		const repositoryRoot = await createRepository();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - path: base.yml
rules:${rule("duplicate.rule", "Root rule.")}`,
		);
		await writeFile(
			path.join(repositoryRoot, "base.yml"),
			`version: 1
rules:${rule("duplicate.rule", "Base rule.")}`,
		);

		await assert.rejects(
			loadRules(repositoryRoot),
			/Rule ID 'duplicate\.rule'.*duplicates the rule from 'base\.yml'/,
		);
	});

	it("loads a pinned Git source and its local extensions", async () => {
		const gitRepository = await createGitRulesRepository();
		const repository = "https://example.test/engineering-rules.git";
		configureGitUrlRewrite(repository, gitRepository.repositoryRoot);
		const repositoryRoot = await createRepository();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: ${repository}
      revision:
        commit: ${gitRepository.commit}
      path: rules/base.yml
rules:${rule("root.rule", "Root rule.")}
`,
		);

		const rules = await loadRules(repositoryRoot);

		assert.deepEqual(
			rules.map(({ id }) => id),
			["git.nested", "git.base", "root.rule"],
		);
	});

	it("gets a branch commit from the root lock file", async () => {
		const gitRepository = await createGitRulesRepository();
		const repository = "https://example.test/locked-rules.git";
		configureGitUrlRewrite(repository, gitRepository.repositoryRoot);
		const repositoryRoot = await createRepository();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: ${repository}
      revision:
        branch: main
      path: rules/base.yml
`,
		);
		await writeFile(
			path.join(repositoryRoot, ".standards.lock"),
			`version: 1
sources:
  - repository: ${repository}
    revision:
      branch: main
    commit: ${gitRepository.commit}
`,
		);

		const rules = await loadRules(repositoryRoot);

		assert.deepEqual(
			rules.map(({ id }) => id),
			["git.nested", "git.base"],
		);
	});

	it("requires a lock file for a branch or tag", async () => {
		const repositoryRoot = await createRepository();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: https://example.test/rules.git
      revision:
        tag: v1
      path: rules.yml
`,
		);

		await assert.rejects(
			loadRules(repositoryRoot),
			(error) =>
				error instanceof ConfigurationResolutionError &&
				error.message.includes(".standards.lock"),
		);
	});

	it("rejects lock entries that the configuration graph does not use", async () => {
		const repositoryRoot = await createRepository();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			"version: 1\n",
		);
		await writeFile(
			path.join(repositoryRoot, ".standards.lock"),
			`version: 1
sources:
  - repository: https://example.test/rules.git
    revision:
      branch: main
    commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
`,
		);

		await assert.rejects(
			loadRules(repositoryRoot),
			/not used by the configuration graph/,
		);
	});
});
