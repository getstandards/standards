import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { modelReferenceSchema } from "./model-reference.js";
import {
	ModelSelectionError,
	resolveSelectedModels,
} from "./model-selection.js";
import type { ReviewModels } from "./review-models.js";

/** Build a Models collection where only the named providers have a credential. */
function modelsWithCredentials(...providers: string[]): ReviewModels {
	const keyByProvider: Record<string, string> = {
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
	};
	const allowed = new Set(
		providers.map((provider) => {
			const name = keyByProvider[provider];
			if (name === undefined) {
				throw new Error(
					`No API key variable mapped for provider '${provider}'.`,
				);
			}
			return name;
		}),
	);
	return builtinModels({
		credentials: new InMemoryCredentialStore(),
		authContext: {
			async env(name) {
				return allowed.has(name) ? "test-key" : undefined;
			},
			async fileExists() {
				return false;
			},
		},
	});
}

describe("resolveSelectedModels", () => {
	it("uses the credentialed provider's default model when nothing selects one", async () => {
		const selected = await resolveSelectedModels({
			environment: {},
			models: modelsWithCredentials("anthropic"),
		});

		expect(selected.evaluation).toBe("anthropic/claude-sonnet-5");
		expect(selected.verification).toBe("anthropic/claude-sonnet-5");
	});

	it("lets a per-step option beat the shared option", async () => {
		const selected = await resolveSelectedModels({
			options: {
				model: "anthropic/claude-sonnet-5",
				verificationModel: "anthropic/claude-opus-5",
			},
			environment: {},
			models: modelsWithCredentials("anthropic"),
		});

		expect(selected.evaluation).toBe("anthropic/claude-sonnet-5");
		expect(selected.verification).toBe("anthropic/claude-opus-5");
	});

	it("lets an option beat an environment variable and a settings field", async () => {
		const selected = await resolveSelectedModels({
			options: { model: "anthropic/claude-opus-5" },
			environment: { STANDARDS_MODEL: "anthropic/claude-sonnet-5" },
			settings: {
				version: 1,
				model: modelReferenceSchema.parse("anthropic/claude-haiku-5"),
			},
			models: modelsWithCredentials("anthropic"),
		});

		expect(selected.evaluation).toBe("anthropic/claude-opus-5");
		expect(selected.verification).toBe("anthropic/claude-opus-5");
	});

	it("lets a per-step environment variable beat the shared environment variable", async () => {
		const selected = await resolveSelectedModels({
			environment: {
				STANDARDS_MODEL: "anthropic/claude-sonnet-5",
				STANDARDS_EVALUATION_MODEL: "anthropic/claude-haiku-5",
			},
			models: modelsWithCredentials("anthropic"),
		});

		expect(selected.evaluation).toBe("anthropic/claude-haiku-5");
		expect(selected.verification).toBe("anthropic/claude-sonnet-5");
	});

	it("rejects an invalid model reference with the source in the diagnostic", async () => {
		await expect(
			resolveSelectedModels({
				options: { model: "not-a-reference" },
				environment: {},
				models: modelsWithCredentials("anthropic"),
			}),
		).rejects.toThrowError(/the --model option is not a valid model reference/);
	});

	it("fails when no provider has a usable credential", async () => {
		await expect(
			resolveSelectedModels({
				environment: {},
				models: modelsWithCredentials(),
			}),
		).rejects.toThrowError(/no provider has a usable credential/);
	});

	it("fails when more than one provider has a usable credential", async () => {
		await expect(
			resolveSelectedModels({
				environment: {},
				models: modelsWithCredentials("anthropic", "openai"),
			}),
		).rejects.toThrowError(/More than one provider has a usable credential/);
	});

	it("fails when a selected provider has no usable credential", async () => {
		const review = resolveSelectedModels({
			options: { model: "openai/gpt-5.5" },
			environment: {},
			models: modelsWithCredentials("anthropic"),
		});

		await expect(review).rejects.toBeInstanceOf(ModelSelectionError);
		await expect(review).rejects.toThrow(
			/names provider 'openai', which has no usable credential/,
		);
	});
});
