import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurationSchema } from "../config/configuration-schema.js";
import { loadLockfile } from "../lockfile/lockfile-loader.js";
import { runGit } from "../utils/git.js";
import { parseSingleYamlDocument } from "../utils/yaml.js";
import type { CliOutput } from "./cli-context.js";
import { runCli } from "./cli-runner.js";
import { VERSION } from "./version.js";

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

	it("creates an empty Standards configuration with init", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "standards-init-"));
		temporaryDirectories.push(directory);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["init"], directory, output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Created .standards.yml");
		expect(stderr).toEqual([]);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(
			configurationSchema.safeParse(parseSingleYamlDocument(content)).success,
		).toBe(true);
	});

	it("fails init when the entry file already exists", async () => {
		const repositoryRoot = await createRepository("version: 1\n");
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["init"], repositoryRoot, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("already exists");
	});

	it("prints the application version with --version", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["--version"], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toMatch(/^\d+\.\d+\.\d+$/);
		expect(stderr).toEqual([]);
	});

	it("rejects --version on a command", async () => {
		const { output, stderr } = captureOutput();

		const exitStatus = await runCli(["review", "--version"], "/unused", output);

		expect(exitStatus).toBe(2);
		expect(stderr[0]).toContain(
			"Command 'review' does not accept the '--version' option.",
		);
	});

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

	it("prints the configuration schema by default", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["schema"], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stderr).toEqual([]);
		const document = JSON.parse(stdout[0] ?? "");
		expect(document.$id).toBe(
			"https://getstandards.dev/schemas/v1/standards.schema.json",
		);
		expect(document.title).toBe("Standards configuration");
	});

	it("prints the lock-file schema", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["schema", "lock"], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stderr).toEqual([]);
		const document = JSON.parse(stdout[0] ?? "");
		expect(document.$id).toBe(
			"https://getstandards.dev/schemas/v1/standards-lock.schema.json",
		);
		expect(document.title).toBe("Standards lock file");
	});

	it("rejects an unknown schema target", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["schema", "bogus"], "/unused", output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Unknown schema target 'bogus'.");
	});

	it("prints help when no command is supplied", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli([], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Usage: standards <command>");
		expect(stdout[0]).toContain(`Standards ${VERSION}`);
		expect(stdout[0]).toContain("█");
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
		expect(stderr[0]).toContain("Usage: standards cache <subcommand>");
	});

	it("prints cache help for cache --help", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["cache", "--help"], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Usage: standards cache <subcommand>");
		expect(stdout[0]).toContain("clean");
		expect(stdout[0]).toContain("prune");
		expect(stderr).toEqual([]);
	});

	it("prints cache help for cache -h", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["cache", "-h"], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Usage: standards cache <subcommand>");
		expect(stderr).toEqual([]);
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

	describe("review", () => {
		/**
		 * A Git repository whose only change between the base and head commits
		 * is a Markdown file, while the one configured rule applies to
		 * TypeScript files. The review selects no rule, so it ends compliant
		 * without a model invocation or a network call.
		 */
		async function createReviewRepository(): Promise<{
			repositoryRoot: string;
			baseRevision: string;
		}> {
			const repositoryRoot = await createRepository(`version: 1
rules:
  - id: example.rule
    level: MUST
    description: Example rule.
    rationale: Example rationale.
    applies_to:
      include:
        - "**/*.ts"
`);
			await runGit(["init", "-q", "-b", "main"], repositoryRoot);
			await runGit(
				["config", "user.email", "test@example.com"],
				repositoryRoot,
			);
			await runGit(["config", "user.name", "Test"], repositoryRoot);
			await writeFile(path.join(repositoryRoot, "notes.md"), "# notes\n");
			await runGit(["add", "-A"], repositoryRoot);
			await runGit(["commit", "-q", "-m", "base"], repositoryRoot);
			const baseRevision = await runGit(["rev-parse", "HEAD"], repositoryRoot);
			await writeFile(
				path.join(repositoryRoot, "notes.md"),
				"# notes updated\n",
			);
			await runGit(["add", "-A"], repositoryRoot);
			await runGit(["commit", "-q", "-m", "head"], repositoryRoot);
			return { repositoryRoot, baseRevision };
		}

		/** Give model selection a provider credential and an explicit model. */
		async function withModelEnvironment<Result>(
			run: () => Promise<Result>,
		): Promise<Result> {
			const previousKey = process.env.ANTHROPIC_API_KEY;
			const previousModel = process.env.STANDARDS_MODEL;
			process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
			process.env.STANDARDS_MODEL = "anthropic/claude-sonnet-5";
			try {
				return await run();
			} finally {
				if (previousKey === undefined) {
					delete process.env.ANTHROPIC_API_KEY;
				} else {
					process.env.ANTHROPIC_API_KEY = previousKey;
				}
				if (previousModel === undefined) {
					delete process.env.STANDARDS_MODEL;
				} else {
					process.env.STANDARDS_MODEL = previousModel;
				}
			}
		}

		it("reports a compliant review when no rule is selected", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(["review", "--base", baseRevision], repositoryRoot, output),
			);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("Standards review: compliant");
			expect(stdout[0]).toContain("Resolved rules:      1");
			expect(stdout[0]).toContain("Selected rules:      0");
		});

		it("writes one JSON document with --format json", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					["review", "--base", baseRevision, "--format", "json"],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout).toHaveLength(1);
			const report = JSON.parse(stdout[0] ?? "");
			expect(report.version).toBe(1);
			expect(report.conclusion).toBe("compliant");
			expect(report.models.evaluation).toBe("anthropic/claude-sonnet-5");
		});

		it("asks for --base or --all when the merge base is unresolvable", async () => {
			const { repositoryRoot } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["review"], repositoryRoot, output);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain("--base");
			expect(stderr[0]).toContain("--all");
		});

		it("rejects a target that does not exist in the head revision", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					["review", "--base", baseRevision, "missing.ts"],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain("Target 'missing.ts'");
		});

		it("rejects --all together with --base", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(
				["review", "--all", "--base", "main"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain(
				"Command 'review' does not accept '--all' and '--base' together.",
			);
		});

		it("prints detailed progress to standard error with --verbose", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					["review", "--base", baseRevision, "--verbose"],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(0);
			expect(stdout[0]).toContain("Standards review: compliant");
			expect(
				stderr.some((line) => line.includes(`Base revision: ${baseRevision}`)),
			).toBe(true);
			expect(stderr.some((line) => line.includes("Head revision:"))).toBe(true);
		});

		it("rejects an unknown review format", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(
				["review", "--format", "yaml"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(2);
			expect(stderr[0]).toContain(
				"Option '--format' expects 'text' or 'json', not 'yaml'.",
			);
		});

		it("rejects review options on other commands", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(["validate", "--all"], "/unused", output);

			expect(exitStatus).toBe(1);
			expect(stderr[0]).toContain(
				"Command 'validate' does not accept the '--all' option.",
			);

			const verboseOutput = captureOutput();
			const verboseStatus = await runCli(
				["validate", "--verbose"],
				"/unused",
				verboseOutput.output,
			);

			expect(verboseStatus).toBe(1);
			expect(verboseOutput.stderr[0]).toContain(
				"Command 'validate' does not accept the '--verbose' option.",
			);
		});

		it("prints review help with the default models", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["review", "--help"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("Usage: standards review");
			expect(stdout[0]).toContain("--verbose");
			expect(stdout[0]).toContain("--verification-model");
			expect(stdout[0]).toContain("Default models:");
			expect(stdout[0]).toContain("claude-sonnet-5");
		});
	});
});
