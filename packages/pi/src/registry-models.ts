import type {
	Api,
	AssistantMessage,
	Context,
	Model,
} from "@earendil-works/pi-ai";
import type { ReviewCompleteOptions, ReviewModels } from "@getstandards/core";

/**
 * The part of pi's model registry the adapter reads (pi 0.84 `ModelRegistry`).
 *
 * The extension states the subset it needs instead of naming pi's class, so a
 * test supplies a fake registry and the adapter keeps working when pi adds
 * methods.
 */
export interface PiModelRegistry {
	getAll(): Model<Api>[];
	find(provider: string, modelId: string): Model<Api> | undefined;
	hasConfiguredAuth(model: Model<Api>): boolean;
	isUsingOAuth(model: Model<Api>): boolean;
	complete(
		model: Model<Api>,
		context: Context,
		options?: ReviewCompleteOptions,
	): Promise<AssistantMessage>;
}

/**
 * Adapt pi's model registry to the models runtime the core review needs.
 *
 * Every model call goes through `complete`, so the review runs on pi's own
 * resolved authentication and the extension never reads a credential. The
 * registry names a model's credential per model, not per provider, so a
 * provider check reads the first model of that provider.
 */
export function createRegistryModels(registry: PiModelRegistry): ReviewModels {
	function firstModelOf(provider: string): Model<Api> | undefined {
		return registry.getAll().find((model) => model.provider === provider);
	}

	return {
		getProviders() {
			const ids = new Set(registry.getAll().map((model) => model.provider));
			return [...ids].map((id) => ({ id }));
		},
		async checkAuth(provider) {
			const model = firstModelOf(provider);
			if (model === undefined || !registry.hasConfiguredAuth(model)) {
				return undefined;
			}
			return { type: registry.isUsingOAuth(model) ? "oauth" : "api_key" };
		},
		getModel(provider, model) {
			return registry.find(provider, model);
		},
		completeSimple(model, context, options) {
			return registry.complete(model, context, options);
		},
	};
}
