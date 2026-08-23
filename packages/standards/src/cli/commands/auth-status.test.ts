import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeProviderModels } from "../../credentials/fake-provider-models.test-helper.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import type { CliOutput, CommandContext } from "../cli-context.js";
import { runAuthStatusCommand } from "./auth-status.js";

vi.mock("../../credentials/models-runtime.js", () => ({
	createStandardsModels: vi.fn(),
}));

const mockCreateStandardsModels = createStandardsModels as Mock;

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

function createContext(output: CliOutput): CommandContext {
	return {
		workingDirectory: "/unused",
		output,
		environment: {},
		noCache: false,
		interactive: false,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runAuthStatusCommand", () => {
	it("names the source of every usable credential", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [
					{ id: "anthropic", check: { type: "oauth", source: "OAuth" } },
					{
						id: "google",
						check: { type: "api_key", source: "GEMINI_API_KEY" },
					},
					{ id: "openai" },
				],
				storedProviderIds: ["anthropic"],
			}),
		);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runAuthStatusCommand(createContext(output));

		expect(exitStatus).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout[0]).toBe(`Provider credentials:

  anthropic  stored (oauth)
  google     environment (GEMINI_API_KEY)

2 of 3 providers have a usable credential.`);
	});

	it("does not list a provider without a usable credential", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [
					{ id: "anthropic", check: { type: "api_key", source: "stored" } },
					{ id: "openai" },
				],
				storedProviderIds: ["anthropic"],
			}),
		);
		const { output, stdout } = captureOutput();

		await runAuthStatusCommand(createContext(output));

		expect(stdout[0]).toContain("anthropic  stored (api-key)");
		expect(stdout[0]).not.toContain("openai");
	});

	it("exits with status 1 when no provider has a usable credential", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [{ id: "anthropic" }, { id: "openai" }],
			}),
		);
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runAuthStatusCommand(createContext(output));

		expect(exitStatus).toBe(1);
		expect(stderr).toEqual([]);
		expect(stdout[0]).toContain("No provider has a usable credential.");
		expect(stdout[0]).toContain("standards auth login <provider>");
	});

	it("reports a provider whose auth check failed without failing the command", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [
					{ id: "anthropic", check: { type: "oauth", source: "OAuth" } },
					{ id: "bedrock", checkProblem: "The AWS profile is unreadable." },
				],
				storedProviderIds: ["anthropic"],
			}),
		);
		const { output, stdout } = captureOutput();

		const exitStatus = await runAuthStatusCommand(createContext(output));

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("anthropic  stored (oauth)");
		expect(stdout[0]).toContain("Could not check:");
		expect(stdout[0]).toContain("bedrock  credential check failed:");
		expect(stdout[0]).toContain("The AWS profile is unreadable.");
		expect(stdout[0]).toContain("1 of 2 providers have a usable credential.");
	});

	it("reports a failed check even when no provider has a usable credential", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [
					{ id: "anthropic" },
					{ id: "bedrock", checkProblem: "The AWS profile is unreadable." },
				],
			}),
		);
		const { output, stdout } = captureOutput();

		const exitStatus = await runAuthStatusCommand(createContext(output));

		expect(exitStatus).toBe(1);
		expect(stdout[0]).toContain("No provider has a usable credential.");
		expect(stdout[0]).toContain("Could not check:");
		expect(stdout[0]).toContain("bedrock  credential check failed:");
		expect(stdout[0]).toContain("The AWS profile is unreadable.");
		expect(stdout[0]).toContain("standards auth login <provider>");
	});

	it("exits with status 2 when the credential store cannot be read", async () => {
		mockCreateStandardsModels.mockImplementation(() => {
			throw new Error("auth.json holds invalid JSON.");
		});
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runAuthStatusCommand(createContext(output));

		expect(exitStatus).toBe(2);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Standards auth status could not run.");
		expect(stderr[0]).toContain("auth.json holds invalid JSON.");
	});
});
