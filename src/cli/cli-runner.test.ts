import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLockfile } from "../lockfile/lockfile-loader.js";
import type { CliOutput } from "./cli-context.js";
import { runCli } from "./cli-runner.js";

const temporaryDirectories: string[] = [];
let previousXdgConfigHome: string | undefined;
let previousXdgCacheHome: string | undefined;

beforeEach(async () => {
	const runtimeDirectory = await mkdtemp(
		path.join(os.tmpdir(), "standards-cli-runtime-test-"),
	);
	temporaryDirectories.push(runtimeDirectory);
	previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	previousXdgCacheHome = process.env.XDG_CACHE_HOME;
	process.env.XDG_CONFIG_HOME = path.join(runtimeDirectory, "config");
	process.env.XDG_CACHE_HOME = path.join(runtimeDirectory, "cache");
});

afterEach(async () => {
	if (previousXdgConfigHome === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
	}
	if (previousXdgCacheHome === undefined) {
		delete process.env.XDG_CACHE_HOME;
	} else {
		process.env.XDG_CACHE_HOME = previousXdgCacheHome;
	}
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function createRepository(configuration: string): Promise<string> {
	const repositoryRoot = await mkdtemp(
		path.join(os.tmpdir(), "standards-cli-test-"),
	);
	temporaryDirectories.push(repositoryRoot);
	await writeFile(path.join(repositoryRoot, ".standards.yml"), configuration);
	return repositoryRoot;
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

describe("runCli", () => {
	it("summarizes the resolved configuration", async () => {
		const repositoryRoot = await createRepository(`version: 1
rules:
  - id: example.rule
    level: MUST
    description: Example rule.
    rationale: Example rationale.
  - id: example.recommendation
    level: SHOULD
    description: Example recommendation.
    rationale: Example rationale.
`);
		await writeFile(
			path.join(repositoryRoot, ".standards.lock"),
			"version: 1\nsources: []\n",
		);
		const canonicalRepositoryRoot = await realpath(repositoryRoot);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(0);
		expect(stdout).toEqual([
			`Standards configuration is valid.

  Repository:     ${canonicalRepositoryRoot}
  Entry file:     .standards.yml
  Lock file:      .standards.lock (present)
  Resolved rules: 2
  Levels:         MUST: 1, SHOULD: 1`,
		]);
		expect(stderr).toEqual([]);
	});

	it("reports an invalid configuration", async () => {
		const repositoryRoot = await createRepository("version: 2\n");
		const canonicalRepositoryRoot = await realpath(repositoryRoot);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([
			`Standards configuration is invalid.

  Category:   Configuration validation
  Repository: ${canonicalRepositoryRoot}
  Source:     .standards.yml
  Field:      version

Problem:
  Invalid input: expected 1

Next action:
  Set 'version' to 1 in '.standards.yml', then run 'standards validate' again.`,
		]);
	});

	it("explains how to fix a missing entry file", async () => {
		const repositoryRoot = await createRepository("version: 1\n");
		await rm(path.join(repositoryRoot, ".standards.yml"));
		const canonicalRepositoryRoot = await realpath(repositoryRoot);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Category:   Configuration resolution");
		expect(stderr[0]).toContain(`Repository: ${canonicalRepositoryRoot}`);
		expect(stderr[0]).toContain("Cannot access configuration");
		expect(stderr[0]).toContain(
			"Create '.standards.yml' at the repository root",
		);
	});

	it("identifies an invalid lock-file field", async () => {
		const repositoryRoot = await createRepository("version: 1\n");
		await writeFile(
			path.join(repositoryRoot, ".standards.lock"),
			"version: 2\nsources: []\n",
		);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Category:   Lock-file validation");
		expect(stderr[0]).toContain("Source:     .standards.lock");
		expect(stderr[0]).toContain("Field:      version");
		expect(stderr[0]).toContain("Set 'version' to 1 in '.standards.lock'");
	});

	it.each(["init", "review"])(
		"runs the reserved %s command without effects",
		async (command) => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli([command], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stdout).toEqual([]);
			expect(stderr).toEqual([]);
		},
	);

	it("updates the lock file", async () => {
		const repositoryRoot = await createRepository("version: 1\n");
		const canonicalRepositoryRoot = await realpath(repositoryRoot);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["lock"], repositoryRoot, output);

		expect(exitStatus).toBe(0);
		expect(stdout).toEqual([
			`Standards lock file updated.

  Repository:      ${canonicalRepositoryRoot}
  Lock file:       .standards.lock
  Mutable sources: 0
  Branches:        0
  Tags:            0`,
		]);
		expect(stderr).toEqual([]);
		expect(
			loadLockfile(
				await readFile(path.join(repositoryRoot, ".standards.lock"), "utf8"),
			),
		).toEqual({ version: 1, sources: [] });

		const secondExitStatus = await runCli(["lock"], repositoryRoot, output);
		expect(secondExitStatus).toBe(0);
		expect(stdout[1]).toContain("Standards lock file is already up to date.");
	});

	it("prints help when no command is supplied", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli([], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Usage: standards <command>");
		expect(stderr).toEqual([]);
	});

	it("rejects unknown commands", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["unknown"], "/unused", output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Unknown command 'unknown'.");
	});

	it("rejects command arguments", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(
			["validate", "repository"],
			"/unused",
			output,
		);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([
			expect.stringContaining(
				"Command 'validate' does not accept arguments or options.",
			),
		]);
	});

	it("rejects unknown options", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["--unknown"], "/unused", output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Unknown option '--unknown'");
	});

	it("requires a subcommand for cache", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["cache"], "/unused", output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Command 'cache' requires a subcommand.");
		expect(stderr[0]).toContain("Usage: standards <command>");
	});

	it("rejects an unknown cache subcommand", async () => {
		const { output, stderr } = captureOutput();

		const exitStatus = await runCli(["cache", "wipe"], "/unused", output);

		expect(exitStatus).toBe(1);
		expect(stderr[0]).toContain("Unknown command 'cache wipe'.");
	});

	it("rejects --no-cache on the cache command", async () => {
		const { output, stderr } = captureOutput();

		const exitStatus = await runCli(
			["cache", "clean", "--no-cache"],
			"/unused",
			output,
		);

		expect(exitStatus).toBe(1);
		expect(stderr[0]).toContain(
			"Command 'cache' does not accept the '--no-cache' option.",
		);
	});

	it("rejects cache options on init", async () => {
		const { output, stderr } = captureOutput();

		const exitStatus = await runCli(
			["init", "--cache-dir", "/tmp/cache"],
			"/unused",
			output,
		);

		expect(exitStatus).toBe(1);
		expect(stderr[0]).toContain(
			"Command 'init' does not accept the '--cache-dir' option.",
		);
	});
});
