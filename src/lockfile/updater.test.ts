import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRules } from "../config/resolver.js";
import { loadLockfile } from "./loader.js";
import { LockfileUpdateError, updateLockfile } from "./updater.js";

const temporaryDirectories: string[] = [];
const environmentRestorations: Array<() => void> = [];

/** Create a temporary directory. */
async function createTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "standards-lock-updater-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

/** Run Git in a test repository. */
function runGit(repositoryRoot: string, arguments_: string[]): string {
	return execFileSync("git", arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim();
}

/** Configure Git to rewrite one HTTPS URL to a local test repository. */
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

/** Create a Git repository with branch and annotated-tag configurations. */
async function createGitSourceRepository(): Promise<{
	repositoryRoot: string;
	commit: string;
}> {
	const repositoryRoot = await createTemporaryDirectory();
	runGit(repositoryRoot, ["init", "--initial-branch=main"]);
	runGit(repositoryRoot, ["config", "user.name", "Standards Test"]);
	runGit(repositoryRoot, ["config", "user.email", "standards@example.com"]);
	runGit(repositoryRoot, ["config", "commit.gpgsign", "false"]);
	runGit(repositoryRoot, ["config", "tag.gpgSign", "false"]);
	await mkdir(path.join(repositoryRoot, "rules"));
	await writeFile(
		path.join(repositoryRoot, "rules", "tag.yml"),
		`version: 1
rules:
  - id: source.tag
    level: MUST
    description: Tag rule.
    rationale: Test rule.
`,
	);
	await writeFile(
		path.join(repositoryRoot, "rules", "branch.yml"),
		`version: 1
rules:
  - id: source.branch
    level: SHOULD
    description: Branch rule.
    rationale: Test rule.
`,
	);
	runGit(repositoryRoot, ["add", "."]);
	runGit(repositoryRoot, ["commit", "--quiet", "--message", "Add rules"]);
	runGit(repositoryRoot, ["tag", "--annotate", "v1", "--message", "Version 1"]);
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

describe("updateLockfile", () => {
	it("resolves, sorts, writes, and reuses mutable source locks", async () => {
		const gitSource = await createGitSourceRepository();
		const repository = "https://example.test/rules.git";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const repositoryRoot = await createTemporaryDirectory();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: ${repository}
      revision:
        tag: v1
      path: rules/tag.yml
  - git:
      repository: ${repository}
      revision:
        branch: main
      path: rules/branch.yml
`,
		);

		const firstResult = await updateLockfile(repositoryRoot);
		const firstContent = await readFile(firstResult.lockfilePath, "utf8");

		expect(firstResult.changed).toBe(true);
		expect(firstResult.lockfile.sources).toEqual([
			{
				repository,
				revision: { branch: "main" },
				commit: gitSource.commit,
			},
			{
				repository,
				revision: { tag: "v1" },
				commit: gitSource.commit,
			},
		]);
		expect(loadLockfile(firstContent)).toEqual(firstResult.lockfile);
		expect(firstContent.startsWith("---\nversion: 1\nsources:\n")).toBe(true);
		expect((await loadRules(repositoryRoot)).map(({ id }) => id)).toEqual([
			"source.tag",
			"source.branch",
		]);

		const secondResult = await updateLockfile(repositoryRoot);
		expect(secondResult.changed).toBe(false);
		expect(await readFile(secondResult.lockfilePath, "utf8")).toBe(
			firstContent,
		);
	});

	it("updates a moved branch without moving an annotated tag", async () => {
		const gitSource = await createGitSourceRepository();
		const repository = "https://example.test/rules.git";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const repositoryRoot = await createTemporaryDirectory();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: ${repository}
      revision:
        tag: v1
      path: rules/tag.yml
  - git:
      repository: ${repository}
      revision:
        branch: main
      path: rules/branch.yml
`,
		);
		await updateLockfile(repositoryRoot);

		await writeFile(
			path.join(gitSource.repositoryRoot, "rules", "branch.yml"),
			`version: 1
rules:
  - id: source.branch
    level: MAY
    description: Updated branch rule.
    rationale: Test rule.
`,
		);
		runGit(gitSource.repositoryRoot, ["add", "."]);
		runGit(gitSource.repositoryRoot, [
			"commit",
			"--quiet",
			"--message",
			"Update branch",
		]);
		const branchCommit = runGit(gitSource.repositoryRoot, [
			"rev-parse",
			"HEAD",
		]);

		const result = await updateLockfile(repositoryRoot);

		expect(result.changed).toBe(true);
		expect(result.lockfile.sources).toEqual([
			{
				repository,
				revision: { branch: "main" },
				commit: branchCommit,
			},
			{
				repository,
				revision: { tag: "v1" },
				commit: gitSource.commit,
			},
		]);
	});

	it("does not fall back from a missing branch to a tag", async () => {
		const gitSource = await createGitSourceRepository();
		const repository = "https://example.test/rules.git";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const repositoryRoot = await createTemporaryDirectory();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: ${repository}
      revision:
        branch: v1
      path: rules/tag.yml
`,
		);

		await expect(updateLockfile(repositoryRoot)).rejects.toThrow(
			new LockfileUpdateError(
				`Git branch 'v1' does not exist in '${repository}'.`,
			),
		);
	});

	it("locks mutable sources from the complete extension graph", async () => {
		const mutableSource = await createGitSourceRepository();
		const mutableRepository = "https://example.test/mutable-rules.git";
		configureGitUrlRewrite(mutableRepository, mutableSource.repositoryRoot);

		const pinnedRepositoryRoot = await createTemporaryDirectory();
		runGit(pinnedRepositoryRoot, ["init", "--initial-branch=main"]);
		runGit(pinnedRepositoryRoot, ["config", "user.name", "Standards Test"]);
		runGit(pinnedRepositoryRoot, [
			"config",
			"user.email",
			"standards@example.com",
		]);
		runGit(pinnedRepositoryRoot, ["config", "commit.gpgsign", "false"]);
		await writeFile(
			path.join(pinnedRepositoryRoot, "base.yml"),
			`version: 1
extends:
  - git:
      repository: ${mutableRepository}
      revision:
        branch: main
      path: rules/branch.yml
`,
		);
		runGit(pinnedRepositoryRoot, ["add", "."]);
		runGit(pinnedRepositoryRoot, [
			"commit",
			"--quiet",
			"--message",
			"Add base",
		]);
		const pinnedCommit = runGit(pinnedRepositoryRoot, ["rev-parse", "HEAD"]);
		const pinnedRepository = "https://example.test/pinned-rules.git";
		configureGitUrlRewrite(pinnedRepository, pinnedRepositoryRoot);

		const repositoryRoot = await createTemporaryDirectory();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			`version: 1
extends:
  - git:
      repository: ${pinnedRepository}
      revision:
        commit: ${pinnedCommit}
      path: base.yml
`,
		);

		const result = await updateLockfile(repositoryRoot);

		expect(result.lockfile.sources).toEqual([
			{
				repository: mutableRepository,
				revision: { branch: "main" },
				commit: mutableSource.commit,
			},
		]);
		expect((await loadRules(repositoryRoot)).map(({ id }) => id)).toEqual([
			"source.branch",
		]);
	});

	it("writes an empty lock file when there are no mutable sources", async () => {
		const repositoryRoot = await createTemporaryDirectory();
		await writeFile(
			path.join(repositoryRoot, ".standards.yml"),
			"version: 1\n",
		);

		const result = await updateLockfile(repositoryRoot);

		expect(result.lockfile).toEqual({ version: 1, sources: [] });
		expect(loadLockfile(await readFile(result.lockfilePath, "utf8"))).toEqual(
			result.lockfile,
		);
	});
});
