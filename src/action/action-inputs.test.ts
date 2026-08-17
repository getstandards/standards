import { describe, expect, it } from "vitest";
import { parseActionInputs } from "./action-inputs.js";

describe("parseActionInputs", () => {
	it("parses inputs provided by the composite action", () => {
		expect(
			parseActionInputs({
				INPUT_ANTHROPIC_API_KEY: "anthropic-token",
				INPUT_GITHUB_TOKEN: "github-token",
			}),
		).toEqual({
			anthropicApiKey: "anthropic-token",
			githubToken: "github-token",
		});
	});

	it("uses supported environment fallbacks", () => {
		expect(
			parseActionInputs({
				ANTHROPIC_API_KEY: "anthropic-token",
				GITHUB_TOKEN: "github-token",
			}),
		).toEqual({
			anthropicApiKey: "anthropic-token",
			githubToken: "github-token",
		});
	});

	it("rejects a missing GitHub token", () => {
		expect(() => parseActionInputs({})).toThrow("A GitHub token is required.");
	});
});
