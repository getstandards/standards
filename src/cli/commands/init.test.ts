import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurationSchema } from "../../config/configuration-schema.js";
import { parseSingleYamlDocument } from "../../utils/yaml.js";
import type { CliOutput, CommandContext } from "../cli-context.js";
import { runInitCommand } from "./init.js";

vi.mock("@inquirer/prompts", () => ({
	select: vi.fn(),
	input: vi.fn(),
}));

const mockSelect = select as Mock;
const mockInput = input as Mock;

const temporaryDirectories: string[] = [];

/** Build a command context and capture its output streams. */
function makeContext(directory: string, interactive: boolean) {
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

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("runInitCommand", () => {
	it("writes a valid empty configuration without a terminal", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-non-tty-"));
		temporaryDirectories.push(directory);
		const { context, stdout, stderr } = makeContext(directory, false);

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("Created .standards.yml");
		expect(stderr).toEqual([]);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		const parsed = parseSingleYamlDocument(content) as unknown;
		expect(configurationSchema.safeParse(parsed).success).toBe(true);
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it("writes a valid empty configuration when the wizard starts from examples", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-examples-"));
		temporaryDirectories.push(directory);
		const { context, stdout } = makeContext(directory, true);
		mockSelect.mockResolvedValueOnce("examples");

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(0);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(stdout[0]).toContain("Created .standards.yml");
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(
			configurationSchema.safeParse(parseSingleYamlDocument(content)).success,
		).toBe(true);
	});

	it("writes a configuration with the rule the wizard collects", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-rule-"));
		temporaryDirectories.push(directory);
		const { context, stdout } = makeContext(directory, true);
		mockSelect.mockResolvedValueOnce("rule").mockResolvedValueOnce("MUST NOT");
		mockInput
			.mockResolvedValueOnce("money.no-float")
			.mockResolvedValueOnce("Money must not be a floating-point number.")
			.mockResolvedValueOnce("Floating-point money loses cents.")
			.mockResolvedValueOnce("**/*.ts");

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("money.no-float");
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(content).toContain("money.no-float");
		expect(content).toContain("MUST NOT");
		const config = configurationSchema.parse(parseSingleYamlDocument(content));
		expect(config.rules.map((rule) => rule.id)).toEqual(["money.no-float"]);
	});

	it("cancels without writing a file", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-cancel-"));
		temporaryDirectories.push(directory);
		const { context, stdout } = makeContext(directory, true);
		mockSelect.mockResolvedValueOnce("cancel");

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("cancelled");
		await expect(
			readFile(path.join(directory, ".standards.yml"), "utf8"),
		).rejects.toThrow();
	});

	it("fails without modifying the file when the entry file already exists", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-exists-"));
		temporaryDirectories.push(directory);
		await writeFile(path.join(directory, ".standards.yml"), "version: 1\n");
		const { context, stdout, stderr } = makeContext(directory, true);
		mockSelect.mockResolvedValueOnce("rule");

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("already exists");
		expect(mockSelect).not.toHaveBeenCalled();

		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(content).toBe("version: 1\n");
	});
});
