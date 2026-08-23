import { describe, expect, it } from "vitest";
import { withoutDatedModelAliases } from "./dated-model-alias.js";

describe("withoutDatedModelAliases", () => {
	it("hides a dated id when its moving alias is listed", () => {
		const result = withoutDatedModelAliases([
			"claude-haiku-4-5",
			"claude-haiku-4-5-20251001",
			"claude-sonnet-5",
		]);

		expect(result).toEqual(["claude-haiku-4-5", "claude-sonnet-5"]);
	});

	it("hides a dashed date suffix", () => {
		const result = withoutDatedModelAliases(["gpt-4o", "gpt-4o-2024-08-06"]);

		expect(result).toEqual(["gpt-4o"]);
	});

	it("keeps a dated id whose moving alias is not listed", () => {
		const result = withoutDatedModelAliases([
			"claude-haiku-4-5-20251001",
			"claude-sonnet-5",
		]);

		expect(result).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-5"]);
	});

	it("keeps a version number that is not a date", () => {
		const result = withoutDatedModelAliases(["gemini-3.1-pro", "grok-4-0709"]);

		expect(result).toEqual(["gemini-3.1-pro", "grok-4-0709"]);
	});
});
