import type {
	AuthContext,
	CredentialStore,
	MutableModels,
} from "@earendil-works/pi-ai";
import {
	defaultProviderAuthContext,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { nonEmptyEnvironmentValue } from "../utils/environment.js";
import { createAuthJsonStore } from "./auth-json-store.js";

/** Runtime values used to build the interactive Standards Models collection. */
export interface StandardsModelsOptions {
	authFilePath: string;
	platform?: NodeJS.Platform;
}

/** The interactive Models collection and the credential store it reads. */
export interface StandardsModels {
	models: MutableModels;
	credentialStore: CredentialStore;
}

/**
 * Build the single Models collection that Standards uses on a person's machine.
 *
 * It registers every built-in pi AI SDK provider and gives the SDK the
 * persistent `auth.json` credential store and the default ambient auth context.
 * A stored credential wins over an ambient credential because the SDK resolves
 * the credential store first. It returns the store so `standards auth logout` and
 * `standards auth status` can read the current credential state.
 */
export function createStandardsModels(
	options: StandardsModelsOptions,
): StandardsModels {
	const credentialStore = createAuthJsonStore({
		authFilePath: options.authFilePath,
		platform: options.platform,
	});
	const models = builtinModels({
		credentials: credentialStore,
		authContext: defaultProviderAuthContext(),
	});
	return { models, credentialStore };
}

/** Runtime values used to build the restricted automation Models collection. */
export interface AutomationModelsOptions {
	environment: NodeJS.ProcessEnv;
	allowedEnvironmentVariables: readonly string[];
}

/**
 * Build an auth context that exposes only the given environment variables and
 * reports every file as missing. It stops automation from reading an AWS
 * profile, Google Application Default Credentials, or an unrelated provider
 * variable.
 */
function createAutomationAuthContext(
	options: AutomationModelsOptions,
): AuthContext {
	const allowed = new Set(options.allowedEnvironmentVariables);
	return {
		async env(name) {
			if (!allowed.has(name)) {
				return undefined;
			}
			return nonEmptyEnvironmentValue(options.environment[name]);
		},
		async fileExists() {
			return false;
		},
	};
}

/**
 * Build the Models collection for the GitHub Action.
 *
 * The Action gets an empty in-memory credential store and an auth context that
 * exposes only the API key variables the Action accepts. This prevents a
 * self-hosted runner from using a stored OAuth credential or an unrelated
 * ambient credential; an OAuth credential belongs to a person's interactive
 * session and is never copied into automation.
 */
export function createAutomationModels(
	options: AutomationModelsOptions,
): MutableModels {
	return builtinModels({
		credentials: new InMemoryCredentialStore(),
		authContext: createAutomationAuthContext(options),
	});
}
