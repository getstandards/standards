import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliOutput } from "../cli-context.js";
import { runCli } from "../cli-runner.js";

const temporaryDirectories: string[] = [];
const environmentRestorations: Array<() => void> = [];

/** Create a temporary directory. */
async function createTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "standards-cache-command-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

/** Build a `runCli` environment whose settings location is an empty directory. */
async function isolatedEnvironment(
	overrides: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
	return { XDG_CONFIG_HOME: await createTemporaryDirectory(), ...overrides };
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
  - git:
      repository: ${repository}
      ref: main
    rules:
      - folder: decisions
        level: MUST
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

function captureOutput(): {
	output: CliOutput;
	stdout: string[];
	stderr: string[];
} {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		output: {
			log: (message) => stdout.push(message),
			error: (message) => stderr.push(message),
		},
		stdout,
		stderr,
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

describe("standards cache", () => {
	it("uses cache_dir from the per-user settings file", async () => {
		const configHome = await createTemporaryDirectory();
		const settingsDirectory = path.join(configHome, "standards");
		const homeDirectory = await createTemporaryDirectory();
		const cacheDirectory = path.join(
			homeDirectory,
			".config",
			"standards",
			"cache",
		);
		await mkdir(settingsDirectory, { recursive: true });
		await mkdir(path.join(cacheDirectory, "git-v1"), { recursive: true });
		await writeFile(
			path.join(settingsDirectory, "settings.yml"),
			"version: 1\ncache_dir: ~/.config/standards/cache\n",
		);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["cache", "clean"], "/unused", output, {
			XDG_CONFIG_HOME: configHome,
			HOME: homeDirectory,
		});

		expect(exitStatus).toBe(0);
		expect(stdout).toEqual([`Removed source cache at ${cacheDirectory}`]);
		expect(stderr).toEqual([]);
		expect(await pathExists(cacheDirectory)).toBe(false);
	});

	it("reports an invalid settings field", async () => {
		const configHome = await createTemporaryDirectory();
		const settingsDirectory = path.join(configHome, "standards");
		await mkdir(settingsDirectory, { recursive: true });
		const settingsPath = path.join(settingsDirectory, "settings.yml");
		await writeFile(settingsPath, "version: 1\ncache_dir: 42\n");
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["cache", "clean"], "/unused", output, {
			XDG_CONFIG_HOME: configHome,
		});

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain(`Source:   ${settingsPath}`);
		expect(stderr[0]).toContain("Field:    cache_dir");
		expect(stderr[0]).toContain("expected string");
	});

	it("removes the cache directory on clean", async () => {
		const cacheDirectory = await createTemporaryDirectory();
		await mkdir(path.join(cacheDirectory, "git-v1"), { recursive: true });
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(
			["cache", "clean"],
			"/unused",
			output,
			await isolatedEnvironment({ STANDARDS_CACHE_DIR: cacheDirectory }),
		);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toBe(`Removed source cache at ${cacheDirectory}`);
		expect(stderr).toEqual([]);
		expect(await pathExists(cacheDirectory)).toBe(false);
	});

	it("reports a missing cache directory on clean", async () => {
		const cacheDirectory = path.join(
			await createTemporaryDirectory(),
			"absent",
		);
		const { output, stdout } = captureOutput();

		const exitStatus = await runCli(
			["cache", "clean"],
			"/unused",
			output,
			await isolatedEnvironment({ STANDARDS_CACHE_DIR: cacheDirectory }),
		);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toBe(
			`Source cache directory does not exist: ${cacheDirectory}`,
		);
	});

	it("removes only unreferenced entries on prune", async () => {
		const gitSource = await createGitKnowledgeRepository();
		const repository = "https://example.test/knowledge.git";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const consumerRoot = await createConsumerRepository(repository);
		const cacheDirectory = await createTemporaryDirectory();
		const bucketDirectory = path.join(cacheDirectory, "git-v1");
		const unreferencedCommit = "d".repeat(40);
		await mkdir(path.join(bucketDirectory, unreferencedCommit), {
			recursive: true,
		});
		await writeFile(`${path.join(bucketDirectory, unreferencedCommit)}.ok`, "");

		const { output, stdout } = captureOutput();
		const exitStatus = await runCli(
			["cache", "prune"],
			consumerRoot,
			output,
			await isolatedEnvironment({ STANDARDS_CACHE_DIR: cacheDirectory }),
		);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toBe("Removed 1 source cache entry.");
		expect(
			await pathExists(path.join(bucketDirectory, unreferencedCommit)),
		).toBe(false);
		expect(await pathExists(path.join(bucketDirectory, gitSource.commit))).toBe(
			true,
		);
	});

	it("reports import progress on standard error and reuses the cache", async () => {
		const gitSource = await createGitKnowledgeRepository();
		const repository = "https://example.test/knowledge.git";
		configureGitUrlRewrite(repository, gitSource.repositoryRoot);
		const consumerRoot = await createConsumerRepository(repository);
		const cacheDirectory = await createTemporaryDirectory();
		const shortCommit = gitSource.commit.slice(0, 12);

		const environment = await isolatedEnvironment({
			STANDARDS_CACHE_DIR: cacheDirectory,
		});

		const firstRun = captureOutput();
		const firstStatus = await runCli(
			["validate"],
			consumerRoot,
			firstRun.output,
			environment,
		);

		expect(firstStatus).toBe(0);
		expect(firstRun.stderr).toEqual([
			`Resolving ${repository} at branch main`,
			`Fetching ${repository} at ${shortCommit}`,
		]);

		const secondRun = captureOutput();
		const secondStatus = await runCli(
			["validate"],
			consumerRoot,
			secondRun.output,
			environment,
		);

		expect(secondStatus).toBe(0);
		expect(secondRun.stderr).toEqual([
			`Resolving ${repository} at branch main`,
			`Cache hit for ${repository} at ${shortCommit}`,
		]);
	});
});
