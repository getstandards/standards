import type {
	Api,
	AssistantMessage,
	AuthCheck,
	Context,
	Model,
} from "@earendil-works/pi-ai";

/** One model provider a review can select a model from. */
export interface ReviewProvider {
	readonly id: string;
}

/** The request options one review model call sets. */
export interface ReviewCompleteOptions {
	signal?: AbortSignal;
	temperature?: number;
}

/**
 * The model access one review needs: the models runtime seam.
 *
 * The core never reads credentials, environment variables, or credential
 * files. Each surface supplies its own runtime: the CLI builds one over the
 * `auth.json` store, the GitHub Action builds a restricted one over the
 * accepted API key variables, and the pi extension adapts pi's model registry.
 *
 * The pi AI SDK `Models` collection satisfies this interface, so a surface that
 * already holds one passes it unchanged.
 */
export interface ReviewModels {
	/** Every registered provider, whether or not it has a credential. */
	getProviders(): readonly ReviewProvider[];
	/** What credential the provider resolves to now, or undefined when it has none. */
	checkAuth(provider: string): Promise<AuthCheck | undefined>;
	/** Resolve one model reference to the model, or undefined when it is unknown. */
	getModel(provider: string, model: string): Model<Api> | undefined;
	/** Run one model turn to its complete assistant message. */
	completeSimple(
		model: Model<Api>,
		context: Context,
		options?: ReviewCompleteOptions,
	): Promise<AssistantMessage>;
}
