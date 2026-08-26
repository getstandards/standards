import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configurationSchema } from "../../config/configuration-schema.js";
import { parseSingleYamlDocument } from "../../utils/yaml.js";
import type { CliOutput, CommandContext } from "../cli-context.js";
import { runInitCommand } from "./init.js";

const temporaryDirectories: string[] = [];

/** Build a command context and capture its output streams. */
function makeContext(directory: string) {
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
		interactive: false,
	};
	return { context, stdout, stderr };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("runInitCommand", () => {
	it("writes a valid empty source configuration", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-write-"));
		temporaryDirectories.push(directory);
		const { context, stdout, stderr } = makeContext(directory);

		const exitStatus = await runInitCommand(context);

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain(`Created .standards.yml in ${directory}.`);
		expect(stderr).toEqual([]);
		const content = await readFile(
			path.join(directory, ".standards.yml"),
			"utf8",
		);
		expect(content).toContain("version: 2");
		expect(content).toContain("sources: []");
		const parsed = parseSingleYamlDocument(content) as unknown;
		expect(configurationSchema.safeParse(parsed).success).toBe(true);
	});

	it("fails without modifying the file when the entry file already exists", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "init-exists-"));
		temporaryDirectories.push(directory);
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
});
