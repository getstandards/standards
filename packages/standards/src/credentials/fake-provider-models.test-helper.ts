import type {
	Api,
	AuthCheck,
	CredentialStore,
	Model,
} from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { StandardsModels } from "./models-runtime.js";

/** One provider of a fake Models collection, with its credential and catalog. */
export interface FakeProvider {
	id: string;
	/** What the auth check reports. Undefined means the provider has no credential. */
	check?: AuthCheck;
	/** The complete catalog that `getModels` and `getAvailable` return. */
	modelIds?: readonly string[];
	/** Make the auth check reject with this problem, to test auth check failure. */
	checkProblem?: string;
	/** Make `getAvailable` reject with this problem, to test catalog failure. */
	catalogProblem?: string;
}

/** How a fake Models collection resolves credentials and catalogs. */
export interface FakeProviderModelsOptions {
	providers: readonly FakeProvider[];
	/** Provider ids that `standards auth login` saved a credential for. */
	storedProviderIds?: readonly string[];
}

/** A catalog entry with placeholder request fields; commands read only `id`. */
function toFakeModel(providerId: string, modelId: string): Model<Api> {
	return {
		id: modelId,
		name: modelId,
		api: "fake-api",
		provider: providerId,
		baseUrl: "https://fake.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	};
}

function neverStreams(): never {
	throw new Error("A fake provider does not stream.");
}

/**
 * Build a real Models collection over fake providers for the credential
 * commands.
 *
 * Each fake provider states its auth check result and catalog, and the SDK
 * resolves `checkAuth` and `getAvailable` through them, so a test states
 * provider credentials and catalogs instead of reaching a real provider. The
 * fake `check` is the single credential source: the store never returns a
 * credential, it only names the stored providers through `list`.
 */
export function createFakeProviderModels(
	options: FakeProviderModelsOptions,
): StandardsModels {
	const { providers, storedProviderIds = [] } = options;
	const byId = new Map(providers.map((provider) => [provider.id, provider]));

	const credentialStore: CredentialStore = {
		read: async () => undefined,
		list: async () =>
			storedProviderIds.map((providerId) => ({
				providerId,
				type: byId.get(providerId)?.check?.type ?? "api_key",
			})),
		modify: async () => undefined,
		delete: async () => {},
	};

	const models = createModels({ credentials: credentialStore });
	for (const fake of providers) {
		models.setProvider(
			createProvider({
				id: fake.id,
				auth: {
					apiKey: {
						name: fake.id,
						check: async () => {
							if (fake.checkProblem !== undefined) {
								throw new Error(fake.checkProblem);
							}
							return fake.check;
						},
						resolve: async () => undefined,
					},
				},
				models: (fake.modelIds ?? []).map((modelId) =>
					toFakeModel(fake.id, modelId),
				),
				// getAvailable applies this filter; getModels stays the catalog.
				filterModels: (catalog) => {
					if (fake.catalogProblem !== undefined) {
						throw new Error(fake.catalogProblem);
					}
					return catalog;
				},
				api: { stream: neverStreams, streamSimple: neverStreams },
			}),
		);
	}

	return { models, credentialStore };
}
