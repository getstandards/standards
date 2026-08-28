import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "@getstandards/core/internal";
import { select } from "@inquirer/prompts";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliOutput } from "./cli-context.js";
import { runCli } from "./cli-runner.js";
import { VERSION } from "./version.js";

vi.mock("@inquirer/prompts", () => ({
	select: vi.fn(),
}));

const mockSelect = select as Mock;

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

/** Write one knowledge document with the given frontmatter lines. */
async function writeRuleDocument(
	repositoryRoot: string,
	documentPath: string,
	frontmatter: string,
): Promise<void> {
	const absolutePath = path.join(repositoryRoot, ...documentPath.split("/"));
	await mkdir(path.dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, `---\n${frontmatter}---\n\nBody text.\n`);
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
		const repositoryRoot = await createRepository(`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions:
        level: MUST
        applies_to:
          include:
            - src/**
          exclude:
            - src/generated/**
      practices: SHOULD
`);
		await writeRuleDocument(
			repositoryRoot,
			"knowledge/decisions/example-rule.md",
			"title: The example rule statement.\nstatus: stable\n",
		);
		await writeRuleDocument(
			repositoryRoot,
			"knowledge/practices/example-recommendation.md",
			"title: The example recommendation statement.\nstatus: stable\n",
		);
		const canonicalRepositoryRoot = await realpath(repositoryRoot);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(0);
		const report = stdout[0] ?? "";
		expect(report).toContain("Standards configuration is valid.");
		expect(report).toContain(`  Repository:     ${canonicalRepositoryRoot}`);
		expect(report).toContain("  Entry file:     .standards.yml");
		expect(report).toContain("Knowledge sources:");
		expect(report).toContain("  ./knowledge");
		expect(report).toContain("    decisions: MUST");
		expect(report).toContain("    practices: SHOULD");
		expect(report).toContain("Rules:");
		expect(report).toMatch(
			/MUST\s+example-rule\s+src\/\*\* except src\/generated\/\*\*/,
		);
		expect(report).toMatch(/SHOULD\s+example-recommendation\s+every file/);
		expect(report).toContain("  Resolved rules: 2");
		expect(report).toContain("  Levels:         MUST: 1, SHOULD: 1");
		expect(stderr).toEqual([]);
	});

	it("validates an empty source list", async () => {
		const repositoryRoot = await createRepository("version: 2\nsources: []\n");
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout[0]).toContain("Resolved rules: 0");
		expect(stdout[0]).toContain("Levels:         none");
	});

	it("warns about a skipped knowledge document", async () => {
		const repositoryRoot = await createRepository(`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions: MUST
`);
		await writeRuleDocument(
			repositoryRoot,
			"knowledge/decisions/good-rule.md",
			"title: The good rule statement.\nstatus: stable\n",
		);
		const badDocumentPath = path.join(
			repositoryRoot,
			"knowledge",
			"decisions",
			"bad-rule.md",
		);
		await writeFile(badDocumentPath, "No frontmatter.\n");
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout[0]).toContain("Resolved rules: 1");
		expect(stdout[0]).toContain("Warnings:");
		expect(stdout[0]).toContain(
			"knowledge/decisions/bad-rule.md: The document has no frontmatter block.",
		);
	});

	it("reports an invalid configuration", async () => {
		const repositoryRoot = await createRepository("version: 1\n");
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
  Invalid input: expected 2

Next action:
  Set 'version' to 2 in '.standards.yml', then run 'standards validate' again.`,
		]);
	});

	it("explains how to fix a missing entry file", async () => {
		const repositoryRoot = await createRepository("version: 2\n");
		await rm(path.join(repositoryRoot, ".standards.yml"));
		const canonicalRepositoryRoot = await realpath(repositoryRoot);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["validate"], repositoryRoot, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Category:   Configuration resolution");
		expect(stderr[0]).toContain(`Repository: ${canonicalRepositoryRoot}`);
		expect(stderr[0]).toContain("Cannot read configuration");
		expect(stderr[0]).toContain(
			"Create '.standards.yml' at the repository root",
		);
	});

	it("refuses init without a terminal and writes nothing", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "standards-init-"));
		temporaryDirectories.push(directory);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["init"], directory, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("interactive input");
		await expect(
			readFile(path.join(directory, ".standards.yml"), "utf8"),
		).rejects.toThrow();
	});

	it("fails init when the entry file already exists", async () => {
		const repositoryRoot = await createRepository("version: 2\n");
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli(["init"], repositoryRoot, output);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("already exists");
	});

	describe("prompt cancellation", () => {
		// runCli only prompts on an interactive terminal, so these tests make
		// stdin and stdout report a TTY.
		beforeEach(() => {
			for (const stream of [process.stdin, process.stdout]) {
				Object.defineProperty(stream, "isTTY", {
					configurable: true,
					value: true,
				});
			}
		});

		afterEach(() => {
			for (const stream of [process.stdin, process.stdout]) {
				delete (stream as { isTTY?: boolean }).isTTY;
			}
		});

		it("stops auth login quietly when the provider prompt is ended with Ctrl+C", async () => {
			// The error inquirer rejects a prompt with on Ctrl+C.
			mockSelect.mockRejectedValueOnce(
				Object.assign(new Error("User force closed the prompt with SIGINT"), {
					name: "ExitPromptError",
				}),
			);
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["auth", "login"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stdout).toEqual([]);
			expect(stderr).toEqual([]);
		});

		it("does not swallow prompt errors that are not cancellations", async () => {
			mockSelect.mockRejectedValueOnce(new Error("prompt exploded"));
			const { output } = captureOutput();

			await expect(
				runCli(["auth", "login"], "/unused", output),
			).rejects.toThrow("prompt exploded");
		});
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

	it("prints help when no command is supplied", async () => {
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runCli([], "/unused", output);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Usage: standards <command>");
		expect(stdout[0]).toContain(`Standards ${VERSION}`);
		expect(stdout[0]).toContain("█");
		expect(stdout[0]).not.toContain("lock");
		expect(stdout[0]).not.toContain("schema");
		expect(stderr).toEqual([]);
	});

	it("lists auth and models as single commands in root help", async () => {
		const { output, stdout } = captureOutput();

		await runCli([], "/unused", output);

		expect(stdout[0]).toContain("auth");
		expect(stdout[0]).toContain("models [provider]");
		expect(stdout[0]).not.toContain(
			"Remove a stored model provider credential",
		);
		expect(stdout[0]).not.toContain("usable credential");
	});

	describe("auth", () => {
		it("prints auth help without a subcommand", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["auth"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("Usage: standards auth <subcommand>");
			expect(stdout[0]).toContain("login <provider>");
			expect(stdout[0]).toContain("logout <provider>");
			expect(stdout[0]).toContain("status");
		});

		it("prints auth help for auth --help", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["auth", "--help"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("Usage: standards auth <subcommand>");
		});

		it("rejects an unknown auth subcommand", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(["auth", "whoami"], "/unused", output);

			expect(exitStatus).toBe(1);
			expect(stderr[0]).toContain("Unknown command 'auth whoami'.");
		});

		it("rejects a provider argument on auth status", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(
				["auth", "status", "anthropic"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(1);
			expect(stderr[0]).toContain(
				"Command 'auth status' does not accept arguments or options.",
			);
		});

		it("rejects the removed top-level login and logout commands", async () => {
			for (const command of ["login", "logout"]) {
				const { output, stdout, stderr } = captureOutput();

				const exitStatus = await runCli([command], "/unused", output);

				expect(exitStatus).toBe(1);
				expect(stdout).toEqual([]);
				expect(stderr[0]).toContain(`Unknown command '${command}'.`);
			}
		});

		it("routes auth status to the credential report", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["auth", "status"], "/unused", output);

			// The temporary XDG_CONFIG_HOME holds no auth.json, so nothing is
			// stored; the ambient environment decides the rest.
			expect([0, 1]).toContain(exitStatus);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("credential");
		});
	});

	describe("models", () => {
		it("prints models help for models --help", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["models", "--help"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain(
				"Usage: standards models [options] [provider]",
			);
			expect(stdout[0]).toContain("--all");
		});

		it("accepts --all, which review also accepts", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["models", "--all"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("providers have a usable credential.");
		});

		it("rejects the review options that models does not accept", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(
				["models", "--verbose"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(1);
			expect(stderr[0]).toContain(
				"Command 'models' does not accept the '--verbose' option.",
			);
		});

		it("rejects more than one provider argument", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(
				["models", "anthropic", "openai"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(1);
			expect(stderr[0]).toContain(
				"Command 'models' accepts at most one provider argument.",
			);
		});

		it("prints the known providers for an unknown provider", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(["models", "bogus"], "/unused", output);

			expect(exitStatus).toBe(1);
			expect(stderr[0]).toContain("Unknown provider 'bogus'.");
		});
	});

	it("rejects unknown commands, including the removed lock and schema", async () => {
		for (const command of ["unknown", "lock", "schema"]) {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli([command], "/unused", output);

			expect(exitStatus).toBe(1);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain(`Unknown command '${command}'.`);
		}
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
		 * is a Markdown note, while the one configured rule applies to
		 * TypeScript files. The review selects no rule, so it ends compliant
		 * without a model invocation or a network call.
		 */
		async function createReviewRepository(): Promise<{
			repositoryRoot: string;
			baseRevision: string;
		}> {
			const repositoryRoot = await createRepository(`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions:
        level: MUST
        applies_to:
          include:
            - "**/*.ts"
`);
			await writeRuleDocument(
				repositoryRoot,
				"knowledge/decisions/example-rule.md",
				`title: The example rule statement.
status: stable
`,
			);
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
			expect(report.version).toBe(3);
			expect(report.conclusion).toBe("compliant");
			expect(report.models.evaluation).toBe("anthropic/claude-sonnet-5");
			expect(report.sources).toEqual([]);
			expect(report.warnings).toEqual([]);
		});

		it("asks for --base, --range, or --all when the merge base is unresolvable", async () => {
			const { repositoryRoot } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["review"], repositoryRoot, output);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain("--base");
			expect(stderr[0]).toContain("--range");
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

		it("rejects two scope options together", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(
				["review", "--staged", "--range", "main..HEAD"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain(
				"Command 'review' does not accept '--range' and '--staged' together.",
			);
		});

		it("rejects --rule together with --folder", async () => {
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(
				["review", "--rule", "a.b", "--folder", "decisions"],
				"/unused",
				output,
			);

			expect(exitStatus).toBe(2);
			expect(stderr[0]).toContain(
				"Command 'review' does not accept '--rule' and '--folder' together",
			);
		});

		it("rejects a --range value without two revisions", async () => {
			const { repositoryRoot } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(
				["review", "--range", "main"],
				repositoryRoot,
				output,
			);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr[0]).toContain("'<base>..<head>'");
		});

		it("rejects a --range revision that Git cannot resolve", async () => {
			const { repositoryRoot } = await createReviewRepository();
			const { output, stderr } = captureOutput();

			const exitStatus = await runCli(
				["review", "--range", "main..nope"],
				repositoryRoot,
				output,
			);

			expect(exitStatus).toBe(2);
			expect(stderr[0]).toContain("Cannot resolve the revision 'nope'");
		});

		it("reviews a commit range with --range", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const headRevision = await runGit(["rev-parse", "HEAD"], repositoryRoot);
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					[
						"review",
						"--range",
						`${baseRevision}..${headRevision}`,
						"--verbose",
					],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(0);
			expect(stdout[0]).toContain("Standards review: compliant");
			expect(
				stderr.some((line) => line.includes(`Head: ${headRevision}`)),
			).toBe(true);
		});

		it("limits the rule set to one rule with --rule", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stdout } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					["review", "--base", baseRevision, "--rule", "example-rule"],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(0);
			expect(stdout[0]).toContain("Resolved rules:      1");
		});

		it("names 'standards validate' for a --rule id that resolves to nothing", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					["review", "--base", baseRevision, "--rule", "missing"],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr.at(-1)).toContain("standards validate");
		});

		it("lists the mapped folders for an unknown --folder", async () => {
			const { repositoryRoot, baseRevision } = await createReviewRepository();
			const { output, stderr } = captureOutput();

			const exitStatus = await withModelEnvironment(() =>
				runCli(
					["review", "--base", baseRevision, "--folder", "missing"],
					repositoryRoot,
					output,
				),
			);

			expect(exitStatus).toBe(2);
			expect(stderr.at(-1)).toContain("decisions");
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
			expect(stderr.some((line) => line.includes("Head: working tree"))).toBe(
				true,
			);
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

		it("prints review help with examples and the default models", async () => {
			const { output, stdout, stderr } = captureOutput();

			const exitStatus = await runCli(["review", "--help"], "/unused", output);

			expect(exitStatus).toBe(0);
			expect(stderr).toEqual([]);
			expect(stdout[0]).toContain("Usage: standards review");
			expect(stdout[0]).toContain("--verbose");
			expect(stdout[0]).toContain("--verification-model");
			expect(stdout[0]).toContain("Examples:");
			expect(stdout[0]).toContain("standards review --range main..HEAD");
			expect(stdout[0]).toContain("Default models:");
			expect(stdout[0]).toContain("claude-sonnet-5");
		});
	});
});
