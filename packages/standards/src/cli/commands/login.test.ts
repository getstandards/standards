import { select } from "@inquirer/prompts";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLoginProvider } from "./login.js";

vi.mock("@inquirer/prompts", () => ({
	select: vi.fn(),
}));

const mockSelect = select as Mock;

const providers: readonly { id: string }[] = [
	{ id: "anthropic" },
	{ id: "openai" },
	{ id: "google" },
];

beforeEach(() => {
	vi.clearAllMocks();
});

describe("resolveLoginProvider", () => {
	it("returns a provider given on the command line without prompting", async () => {
		const result = await resolveLoginProvider(true, "openai", providers);

		expect(result).toBe("openai");
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it("lets an interactive terminal pick from the known providers", async () => {
		mockSelect.mockResolvedValueOnce("anthropic");

		const result = await resolveLoginProvider(true, undefined, providers);

		expect(result).toBe("anthropic");
		expect(mockSelect).toHaveBeenCalledTimes(1);
		const options = mockSelect.mock.calls[0]?.[0] as { choices: unknown[] };
		expect(options.choices).toEqual([
			{ name: "anthropic", value: "anthropic" },
			{ name: "openai", value: "openai" },
			{ name: "google", value: "google" },
		]);
	});

	it("does not prompt without an interactive terminal", async () => {
		const result = await resolveLoginProvider(false, undefined, providers);

		expect(result).toBeUndefined();
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it("does not prompt when no provider is known", async () => {
		const result = await resolveLoginProvider(true, undefined, []);

		expect(result).toBeUndefined();
		expect(mockSelect).not.toHaveBeenCalled();
	});
});
