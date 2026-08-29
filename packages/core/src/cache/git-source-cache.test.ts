import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRules } from "../rules/rules-loader.js";
import { openGitSourceCache } from "./git-source-cache.js";
import type { ImportProgressReporter } from "./import-progress.js";

const temporaryDirectories: string[] = [];
const environmentRestorations: Array<() => void> = [];

/** Create a temporary directory. */
async function createTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-cache-"));
	temporaryDirectories.push(directory);
	return directory;
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
async function createGitKnowledgeRepository(): Promise<{
	repositoryRoot: string;
	commit: string;
}> {
	const repositoryRoot = await createTemporaryDirectory();
	runGit(repositoryRoot, ["init", "--initial-branch=main"]);
	runGit(repositoryRoot, ["config", "user.name", "Standards Test"]);
	runGit(repositoryRoot, ["config", "user.email", "standards@example.com"]);
	await mkdir(path.join(repositoryRoot, "decisions"), { recursive: true });
	await writeFile(
		path.join(repositoryRoot, "decisions", "git-rule.md"),
		`---
title: Git rule
---

Test rule.
`,
	);
	runGit(repositoryRoot, ["add", "."]);
	runGit(repositoryRoot, ["commit", "--quiet", "--message", "Add knowledge"]);
	return {
		repositoryRoot,
		commit: runGit(repositoryRoot, ["rev-parse", "HEAD"]),
	};
}

/** Create a consumer repository that follows one Git source branch. */
async function createConsumerRepository(repository: string): Promise<string> {
	const repositoryRoot = await createTemporaryDirectory();
	await writeFile(
		path.join(repositoryRoot, ".standards.yml"),
		`version: 2
sources:
  - repository: ${repository}
    branch: main
    folders:
      decisions: MUST
`,
	);
	return repositoryRoot;
}

/** Return whether a path exists. */
async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

/** Record every commit reported as imported. */
function collectImportedCommits(): {
	reporter: ImportProgressReporter;
	cacheHits: string[];
	fetches: string[];
} {
	const cacheHits: string[] = [];
	const fetches: string[] = [];
	return {
		reporter: {
			reportResolvingRevision: () => {},
			reportCacheHit: (_repository, commit) => cacheHits.push(commit),
			reportFetch: (_repository, commit) => fetches.push(commit),
		},
		cacheHits,
		fetches,
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

describe("openGitSourceCache", () => {
	it("returns a hit only after a completion marker is written", async () => {
		const cacheDirectory = await createTemporaryDirectory();
		const store = await openGitSourceCache(cacheDirectory);
		const commit = "a".repeat(40);
		const entryDirectory = path.join(cacheDirectory, "git-v1", commit);

		const firstCheckout = await store.provideGitCheckout(
			commit,
			async (destination) => {
				await writeFile(path.join(destination, "rules.yml"), "version: 1\n");
			},
		);

		expect(firstCheckout).toEqual({
			contentDirectory: entryDirectory,
			cacheHit: false,
		});
		expect(await pathExists(`${entryDirectory}.ok`)).toBe(true);
		expect(await pathExists(path.join(entryDirectory, "rules.yml"))).toBe(true);

		let populateCalls = 0;
		const secondCheckout = await store.provideGitCheckout(commit, async () => {
			populateCalls += 1;
		});

		expect(secondCheckout.cacheHit).toBe(true);
		expect(populateCalls).toBe(0);
	});

	it("does not write a marker when the checkout fails verification", async () => {
		const cacheDirectory = await createTemporaryDirectory();
		const store = await openGitSourceCache(cacheDirectory);
		const commit = "b".repeat(40);
		const entryDirectory = path.join(cacheDirectory, "git-v1", commit);

		await expect(
			store.provideGitCheckout(commit, async () => {
				throw new Error("Commit verification failed.");
			}),
		).rejects.toThrow("Commit verification failed.");

		expect(await pathExists(`${entryDirectory}.ok`)).toBe(false);
		expect(await pathExists(entryDirectory)).toBe(false);
	});

	it("stores a verified checkout without a .git directory and reuses it", async () => {
		const gitSource = await createGitKnowledgeRepository();
		const repository = "https://example.test/knowledge.git";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const consumerRoot = await createConsumerRepository(repository);
		const cacheDirectory = await createTemporaryDirectory();
		const entryDirectory = path.join(
			cacheDirectory,
			"git-v1",
			gitSource.commit,
		);

		const firstRun = collectImportedCommits();
		const firstStore = await openGitSourceCache(cacheDirectory);
		const firstResult = await loadRules(consumerRoot, {
			gitSourceStore: firstStore,
			reportProgress: firstRun.reporter,
		});
		await firstStore.dispose();

		expect(firstResult.rules.map(({ id }) => id)).toEqual(["git-rule"]);
		expect(firstRun.fetches).toEqual([gitSource.commit]);
		expect(firstRun.cacheHits).toEqual([]);
		expect(
			await pathExists(path.join(entryDirectory, "decisions", "git-rule.md")),
		).toBe(true);
		expect(await pathExists(path.join(entryDirectory, ".git"))).toBe(false);

		const secondRun = collectImportedCommits();
		const secondStore = await openGitSourceCache(cacheDirectory);
		const secondResult = await loadRules(consumerRoot, {
			gitSourceStore: secondStore,
			reportProgress: secondRun.reporter,
		});
		await secondStore.dispose();

		expect(secondResult.rules.map(({ id }) => id)).toEqual(["git-rule"]);
		expect(secondResult.gitSources).toEqual([
			{ repository, branch: "main", commit: gitSource.commit },
		]);
		expect(secondRun.cacheHits).toEqual([gitSource.commit]);
		expect(secondRun.fetches).toEqual([]);
	});
});
