import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeProviderModels } from "../../credentials/fake-provider-models.test-helper.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import type { CliOutput, CommandContext } from "../cli-context.js";
import { runModelsCommand } from "./models-list.js";

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

/** One credentialed provider, one without, and one dated model alias. */
function createMixedProviders(): void {
	mockCreateStandardsModels.mockReturnValue(
		createFakeProviderModels({
			providers: [
				{
					id: "anthropic",
					check: { type: "oauth", source: "OAuth" },
					modelIds: [
						"claude-sonnet-5",
						"claude-haiku-4-5",
						"claude-haiku-4-5-20251001",
					],
				},
				{ id: "openai", modelIds: ["gpt-5.5", "gpt-5.5-mini"] },
			],
			storedProviderIds: ["anthropic"],
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runModelsCommand", () => {
	it("lists complete model references for credentialed providers only", async () => {
		createMixedProviders();
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			all: false,
		});

		expect(exitStatus).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout[0]).toBe(`anthropic  stored (oauth)
  anthropic/claude-sonnet-5 (default)
  anthropic/claude-haiku-4-5

1 of 2 providers have a usable credential.

Next actions:
  Run 'standards models --all' to list every provider and model.
  Run 'standards auth login <provider>' to add a provider credential.`);
	});

	it("lists every provider and every model id with --all", async () => {
		createMixedProviders();
		const { output, stdout } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			all: true,
		});

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("anthropic/claude-haiku-4-5-20251001");
		expect(stdout[0]).toContain("openai  no credential");
		expect(stdout[0]).toContain("openai/gpt-5.5 (default)");
		expect(stdout[0]).not.toContain("standards models --all");
	});

	it("shows the catalog and a login hint for one provider without a credential", async () => {
		createMixedProviders();
		const { output, stdout } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			provider: "openai",
			all: false,
		});

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toBe(`openai  no credential
  openai/gpt-5.5 (default)
  openai/gpt-5.5-mini

Provider 'openai' has no usable credential.

Next action:
  Run 'standards auth login openai' to store a credential.`);
	});

	it("scopes the listing to one credentialed provider", async () => {
		createMixedProviders();
		const { output, stdout } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			provider: "anthropic",
			all: false,
		});

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("anthropic  stored (oauth)");
		expect(stdout[0]).not.toContain("has no usable credential");
	});

	it("prints the known providers for an unknown provider", async () => {
		createMixedProviders();
		const { output, stdout, stderr } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			provider: "bogus",
			all: false,
		});

		expect(exitStatus).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Unknown provider 'bogus'.");
		expect(stderr[0]).toContain("Known providers:");
		expect(stderr[0]).toContain("anthropic");
	});

	it("names the next action when no provider has a usable credential", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [{ id: "anthropic", modelIds: ["claude-sonnet-5"] }],
			}),
		);
		const { output, stdout } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			all: false,
		});

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("No provider has a usable credential.");
		expect(stdout[0]).toContain("standards auth login <provider>");
		expect(stdout[0]).toContain("standards models --all");
	});

	it("keeps listing the other providers when one catalog fails", async () => {
		mockCreateStandardsModels.mockReturnValue(
			createFakeProviderModels({
				providers: [
					{
						id: "anthropic",
						check: { type: "oauth", source: "OAuth" },
						modelIds: ["claude-sonnet-5"],
					},
					{
						id: "openrouter",
						check: { type: "api_key", source: "OPENROUTER_API_KEY" },
						catalogProblem: "The model list request timed out.",
					},
				],
				storedProviderIds: ["anthropic"],
			}),
		);
		const { output, stdout } = captureOutput();

		const exitStatus = await runModelsCommand(createContext(output), {
			all: false,
		});

		expect(exitStatus).toBe(0);
		expect(stdout[0]).toContain("anthropic/claude-sonnet-5 (default)");
		expect(stdout[0]).toContain(
			"Could not list the models: The model list request timed out.",
		);
		expect(stdout[0]).toContain("2 of 2 providers have a usable credential.");
	});
});
