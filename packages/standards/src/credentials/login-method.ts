import type { AuthType, Provider } from "@earendil-works/pi-ai";

/**
 * The login method that `standards login` runs for a provider, or a report
 * that the provider has no interactive method and uses ambient credentials.
 */
export type ProviderLoginMethod =
	| { kind: "login"; type: AuthType }
	| { kind: "ambient"; ambientSource: string };

/**
 * Select the login method for a provider from its registered SDK auth methods.
 *
 * A subscription OAuth method wins. Otherwise an interactive API key method
 * wins. Otherwise a non-subscription OAuth method is used. A provider with no
 * interactive method uses ambient credentials only.
 */
export function selectProviderLoginMethod(
	provider: Provider,
): ProviderLoginMethod {
	const { apiKey, oauth } = provider.auth;

	if (oauth?.isSubscription === true) {
		return { kind: "login", type: "oauth" };
	}
	if (apiKey?.login !== undefined) {
		return { kind: "login", type: "api_key" };
	}
	if (oauth !== undefined) {
		return { kind: "login", type: "oauth" };
	}
	return {
		kind: "ambient",
		ambientSource: apiKey?.name ?? `${provider.name} ambient credentials`,
	};
}

/** Return the user-facing credential kind, `oauth` or `api-key`, for a stored type. */
export function credentialKindLabel(type: AuthType): "oauth" | "api-key" {
	return type === "api_key" ? "api-key" : "oauth";
}
