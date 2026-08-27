import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurationSchema } from "../../config/configuration-schema.js";
import { parseSingleYamlDocument } from "../../utils/yaml.js";
import type { CliOutput, CommandContext } from "../cli-context.js";
import type { ScanResult } from "./init.js";
import { runInitCommand } from "./init.js";

vi.mock("@inquirer/prompts", () => ({
	select: vi.fn(),
	input: vi.fn(),
	checkbox: vi.fn(),
	confirm: vi.fn(),
}));

const mockSelect = select as Mock;
const mockInput = input as Mock;
const mockCheckbox = checkbox as Mock;
const mockConfirm = confirm as Mock;

const temporaryDirectories: string[] = [];

/** Build a command context and capture its output streams. */
function makeContext(directory: string, interactive = true) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const output: CliOutput = {
		log: (message) => stdout.push(message),
		error: (message) => stderr.push(message),
	};
	const context: CommandContext = {
		workingDirectory: directory,
		output,
		environment: {},
		noCache: false,
		interactive,
	};
	return { context, stdout, stderr };
}

/** Queue answers for one prompt function in order. */
function queue(mock: Mock, ...answers: unknown[]): void {
	for (const answer of answers) {
		mock.mockResolvedValueOnce(answer);
	}
}

beforeEach(() => {
	for (const mock of [mockSelect, mockInput, mockCheckbox, mockConfirm]) {
		mock.mockReset();
	}
});

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory(prefix: string): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

describe("runInitCommand", () => {
	it("refuses without a terminal and writes nothing", async () => {
		const directory = await temporaryDirectory("init-no-tty-");
		const { context, stdout, stderr } = makeContext(directory, false);

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("interactive input");
		await expect(
			readFile(path.join(directory, ".standards.yml"), "utf8"),
		).rejects.toThrow();
	});

	it("refuses to replace an existing entry file", async () => {
		const directory = await temporaryDirectory("init-exists-");
		await writeFile(path.join(directory, ".standards.yml"), "version: 2\n");
		const { context, stdout, stderr } = makeContext(directory);

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("already exists");
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(content).toBe("version: 2\n");
	});

	it("refuses to shadow an existing .standards.yaml entry file", async () => {
		const directory = await temporaryDirectory("init-yaml-exists-");
		await writeFile(path.join(directory, ".standards.yaml"), "version: 2\n");
		const { context, stdout, stderr } = makeContext(directory);

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("'.standards.yaml' already exists");
		await expect(
			readFile(path.join(directory, ".standards.yml"), "utf8"),
		).rejects.toThrow();
	});

	it("builds a local source from a scan and writes on confirmation", async () => {
		const directory = await temporaryDirectory("init-local-");
		const { context, stdout } = makeContext(directory);
		const scan = vi.fn(
			async (): Promise<ScanResult> => ({
				folders: [
					{ folder: "decisions", documentCount: 3 },
					{ folder: "practices", documentCount: 5 },
				],
				scanned: true,
			}),
		);
		queue(mockSelect, "local", "MUST", "SHOULD");
		queue(mockInput, "knowledge", "");
		queue(mockCheckbox, ["decisions", "practices"]);
		queue(
			mockConfirm,
			false, // documents exclude for decisions
			false, // applies_to for decisions
			false, // documents exclude for practices
			false, // applies_to for practices
			false, // add another source
			true, // write the file
		);

		const exitStatus = await runInitCommand(context, scan);

		expect(exitStatus).toBe(0);
		expect(scan).toHaveBeenCalledWith(
			{ kind: "local", path: "knowledge" },
			directory,
		);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		const parsed = parseSingleYamlDocument(content) as unknown;
		expect(configurationSchema.safeParse(parsed).success).toBe(true);
		expect(content).toContain("path: knowledge");
		expect(content).toContain("decisions: MUST");
		expect(content).toContain("practices: SHOULD");
		expect(stdout.at(-1)).toContain("standards validate");
	});

	it("builds a Git source with a branch and id prefix", async () => {
		const directory = await temporaryDirectory("init-git-");
		const { context } = makeContext(directory);
		const scan = vi.fn(
			async (): Promise<ScanResult> => ({ folders: [], scanned: false }),
		);
		queue(mockSelect, "git", "MUST");
		queue(
			mockInput,
			"https://github.com/acme/knowledge.git", // repository
			"main", // branch
			"knowledge", // bundle path
			"reliability", // manual folder entry
			"shared", // id_prefix
		);
		queue(mockConfirm, false, false, false, true);

		const exitStatus = await runInitCommand(context, scan);

		expect(exitStatus).toBe(0);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(
			configurationSchema.safeParse(parseSingleYamlDocument(content)).success,
		).toBe(true);
		expect(content).toContain(
			"repository: https://github.com/acme/knowledge.git",
		);
		expect(content).toContain("branch: main");
		expect(content).toContain("id_prefix: shared");
		expect(content).toContain("reliability: MUST");
	});

	it("configures document exclusions and a target file filter", async () => {
		const directory = await temporaryDirectory("init-filters-");
		const { context } = makeContext(directory);
		const scan = vi.fn(
			async (): Promise<ScanResult> => ({
				folders: [{ folder: "guides", documentCount: 4 }],
				scanned: true,
			}),
		);
		queue(mockSelect, "local", "SHOULD");
		queue(
			mockInput,
			"knowledge", // bundle root
			"templates/**", // document exclude globs
			"src/**", // applies_to include
			"", // applies_to exclude
			"", // id_prefix
		);
		queue(mockCheckbox, ["guides"]);
		queue(
			mockConfirm,
			true, // documents exclude
			true, // scope files
			false, // add another
			true, // write
		);

		const exitStatus = await runInitCommand(context, scan);

		expect(exitStatus).toBe(0);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		const parsed = parseSingleYamlDocument(content) as {
			sources: Array<{ folders: Record<string, unknown> }>;
		};
		expect(parsed.sources[0]?.folders.guides).toEqual({
			level: "SHOULD",
			documents: { exclude: ["templates/**"] },
			applies_to: { include: ["src/**"] },
		});
	});

	it("adds more than one knowledge source", async () => {
		const directory = await temporaryDirectory("init-multi-");
		const { context } = makeContext(directory);
		const scan = vi.fn(
			async (): Promise<ScanResult> => ({ folders: [], scanned: false }),
		);
		queue(mockSelect, "local", "MUST", "local", "SHOULD");
		queue(
			mockInput,
			"knowledge", // first bundle root
			"decisions", // first manual folder
			"", // first id_prefix
			"more-knowledge", // second bundle root
			"practices", // second manual folder
			"", // second id_prefix
		);
		queue(
			mockConfirm,
			false, // first documents exclude
			false, // first applies_to
			true, // add another source
			false, // second documents exclude
			false, // second applies_to
			false, // add another source
			true, // write
		);

		const exitStatus = await runInitCommand(context, scan);

		expect(exitStatus).toBe(0);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		const parsed = parseSingleYamlDocument(content) as {
			sources: Array<{ path: string }>;
		};
		expect(parsed.sources.map((source) => source.path)).toEqual([
			"knowledge",
			"more-knowledge",
		]);
	});

	it("leaves the repository unchanged when the user declines the preview", async () => {
		const directory = await temporaryDirectory("init-cancel-");
		const { context, stdout } = makeContext(directory);
		const scan = vi.fn(
			async (): Promise<ScanResult> => ({
				folders: [{ folder: "decisions", documentCount: 1 }],
				scanned: true,
			}),
		);
		queue(mockSelect, "local", "MUST");
		queue(mockInput, "knowledge", "");
		queue(mockCheckbox, ["decisions"]);
		queue(
			mockConfirm,
			false, // documents exclude
			false, // applies_to
			false, // add another
			false, // write -> declined
		);

		const exitStatus = await runInitCommand(context, scan);

		expect(exitStatus).toBe(0);
		expect(stdout.at(-1)).toContain("No changes made.");
		await expect(
			readFile(path.join(directory, ".standards.yml"), "utf8"),
		).rejects.toThrow();
	});
});
