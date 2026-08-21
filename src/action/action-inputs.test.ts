import { describe, expect, it } from "vitest";
import { buildReviewEnvironment, parseActionInputs } from "./action-inputs.js";

describe("parseActionInputs", () => {
	it("parses every action input from the runner environment", () => {
		expect(
			parseActionInputs({
				"INPUT_GITHUB-TOKEN": "github-token",
				"INPUT_ANTHROPIC-API-KEY": "anthropic-key",
				"INPUT_OPENAI-API-KEY": "openai-key",
				"INPUT_GOOGLE-API-KEY": "google-key",
				INPUT_MODEL: "anthropic/claude-sonnet-5",
				"INPUT_EVALUATION-MODEL": "openai/gpt-5.5",
				"INPUT_VERIFICATION-MODEL": "anthropic/claude-opus-5",
				"INPUT_PROVIDER-ENV": "OPENROUTER_API_KEY, CLOUDFLARE_ACCOUNT_ID",
			}),
		).toEqual({
			githubToken: "github-token",
			anthropicApiKey: "anthropic-key",
			openaiApiKey: "openai-key",
			googleApiKey: "google-key",
			model: "anthropic/claude-sonnet-5",
			evaluationModel: "openai/gpt-5.5",
			verificationModel: "anthropic/claude-opus-5",
			providerEnv: ["OPENROUTER_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
		});
	});

	it("treats an empty input as not given", () => {
		const inputs = parseActionInputs({
			"INPUT_GITHUB-TOKEN": "github-token",
			"INPUT_ANTHROPIC-API-KEY": "",
		});
		expect(inputs.anthropicApiKey).toBeUndefined();
		expect(inputs.providerEnv).toEqual([]);
	});

	it("rejects a missing GitHub token", () => {
		expect(() => parseActionInputs({})).toThrow("A GitHub token is required.");
	});

	it("rejects a provider-env entry that is not a variable name", () => {
		expect(() =>
			parseActionInputs({
				"INPUT_GITHUB-TOKEN": "github-token",
				"INPUT_PROVIDER-ENV": "sk-live-key",
			}),
		).toThrow("environment variable name");
	});
});

describe("buildReviewEnvironment", () => {
	it("maps each input to its one review environment variable", () => {
		const review = buildReviewEnvironment(
			parseActionInputs({
				"INPUT_GITHUB-TOKEN": "github-token",
				"INPUT_ANTHROPIC-API-KEY": "anthropic-key",
				"INPUT_GOOGLE-API-KEY": "google-key",
				INPUT_MODEL: "anthropic/claude-sonnet-5",
			}),
			{},
		);
		expect(review.environment).toEqual({
			ANTHROPIC_API_KEY: "anthropic-key",
			GEMINI_API_KEY: "google-key",
			STANDARDS_MODEL: "anthropic/claude-sonnet-5",
		});
		expect(review.hasCredential).toBe(true);
	});

	it("copies only the variables named in provider-env from the step", () => {
		const review = buildReviewEnvironment(
			parseActionInputs({
				"INPUT_GITHUB-TOKEN": "github-token",
				"INPUT_PROVIDER-ENV": "OPENROUTER_API_KEY",
			}),
			{
				OPENROUTER_API_KEY: "openrouter-key",
				GROQ_API_KEY: "ambient-key-not-allowed",
				ANTHROPIC_API_KEY: "ambient-key-not-allowed",
			},
		);
		expect(review.environment).toEqual({
			OPENROUTER_API_KEY: "openrouter-key",
		});
		expect(review.allowedEnvironmentVariables).toEqual([
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GEMINI_API_KEY",
			"OPENROUTER_API_KEY",
		]);
		expect(review.hasCredential).toBe(true);
	});

	it("reports the missing credential when no variable holds one", () => {
		const review = buildReviewEnvironment(
			parseActionInputs({ "INPUT_GITHUB-TOKEN": "github-token" }),
			{ ANTHROPIC_API_KEY: "ambient-key-not-allowed" },
		);
		expect(review.hasCredential).toBe(false);
		expect(review.environment).toEqual({});
	});
});
