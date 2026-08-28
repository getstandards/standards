import type {
	Api,
	AssistantMessage,
	Context,
	Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	createRegistryModels,
	type PiModelRegistry,
} from "./registry-models.js";

/** A catalog entry with placeholder request fields; the adapter reads ids. */
function fakeModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "fake-api",
		provider,
		baseUrl: "https://fake.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	};
}

const reply: AssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "ok" }],
	stopReason: "stop",
	model: "claude-sonnet-5",
	provider: "anthropic",
	api: "fake-api",
	usage: {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	timestamp: Date.now(),
};

/** A registry over a fixed catalog, recording what `complete` received. */
function fakeRegistry(options: {
	models: Model<Api>[];
	configured?: readonly string[];
	oauth?: readonly string[];
	calls?: { model: Model<Api>; context: Context }[];
}): PiModelRegistry {
	const configured = new Set(options.configured ?? []);
	const oauth = new Set(options.oauth ?? []);
	return {
		getAll: () => options.models,
		find: (provider, modelId) =>
			options.models.find(
				(model) => model.provider === provider && model.id === modelId,
			),
		hasConfiguredAuth: (model) => configured.has(model.provider),
		isUsingOAuth: (model) => oauth.has(model.provider),
		complete: async (model, context) => {
			options.calls?.push({ model, context });
			return reply;
		},
	};
}

describe("createRegistryModels", () => {
	it("reports one provider per distinct provider in the catalog", () => {
		const models = createRegistryModels(
			fakeRegistry({
				models: [
					fakeModel("anthropic", "claude-sonnet-5"),
					fakeModel("anthropic", "claude-opus-5"),
					fakeModel("openai", "gpt-5.5"),
				],
			}),
		);

		expect(models.getProviders().map((provider) => provider.id)).toEqual([
			"anthropic",
			"openai",
		]);
	});

	it("reports no credential for a provider pi has no configured auth for", async () => {
		const models = createRegistryModels(
			fakeRegistry({
				models: [
					fakeModel("anthropic", "claude-sonnet-5"),
					fakeModel("openai", "gpt-5.5"),
				],
				configured: ["anthropic"],
			}),
		);

		expect(await models.checkAuth("anthropic")).toEqual({ type: "api_key" });
		expect(await models.checkAuth("openai")).toBeUndefined();
		expect(await models.checkAuth("google")).toBeUndefined();
	});

	it("reports an oauth credential so the review's cost is an estimate", async () => {
		const models = createRegistryModels(
			fakeRegistry({
				models: [fakeModel("anthropic", "claude-sonnet-5")],
				configured: ["anthropic"],
				oauth: ["anthropic"],
			}),
		);

		expect(await models.checkAuth("anthropic")).toEqual({ type: "oauth" });
	});

	it("resolves a model reference through the registry", () => {
		const models = createRegistryModels(
			fakeRegistry({ models: [fakeModel("anthropic", "claude-sonnet-5")] }),
		);

		expect(models.getModel("anthropic", "claude-sonnet-5")?.id).toBe(
			"claude-sonnet-5",
		);
		expect(models.getModel("anthropic", "missing")).toBeUndefined();
	});

	it("runs a model turn through the registry's complete", async () => {
		const calls: { model: Model<Api>; context: Context }[] = [];
		const model = fakeModel("anthropic", "claude-sonnet-5");
		const models = createRegistryModels(
			fakeRegistry({ models: [model], calls }),
		);

		const context: Context = { messages: [] };
		const message = await models.completeSimple(model, context);

		expect(message.stopReason).toBe("stop");
		expect(calls).toEqual([{ model, context }]);
	});
});
