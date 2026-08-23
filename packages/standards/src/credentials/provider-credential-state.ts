import type { CredentialStore, Models } from "@earendil-works/pi-ai";
import { errorMessage } from "../utils/errors.js";
import { credentialKindLabel } from "./login-method.js";

/**
 * Where the usable credential of one provider comes from.
 *
 * `stored` is a credential that `standards auth login` saved in `auth.json`.
 * `environment` is an ambient credential, such as an API key environment
 * variable. `none` means the provider has no usable credential at all.
 * `unreadable` means the auth check itself failed, so the state is unknown.
 */
export type ProviderCredentialState =
	| { kind: "stored"; credentialKind: "oauth" | "api-key" }
	| { kind: "environment"; source?: string }
	| { kind: "none" }
	| { kind: "unreadable"; problem: string };

/** The credential state of one model provider, with its SDK provider id. */
export interface ProviderCredentialReport {
	providerId: string;
	state: ProviderCredentialState;
}

/** True when the provider has a credential that a review can use right now. */
export function hasUsableCredential(report: ProviderCredentialReport): boolean {
	return report.state.kind === "stored" || report.state.kind === "environment";
}

/**
 * Read the credential state of one provider.
 *
 * `checkAuth` decides whether the credential is usable and names its ambient
 * source. The set of stored provider ids separates a credential that
 * `standards auth login` saved from an ambient one, because a stored
 * credential owns its provider (specs/credentials.md credential resolution).
 */
async function readProviderCredentialState(
	models: Models,
	providerId: string,
	storedProviderIds: ReadonlySet<string>,
): Promise<ProviderCredentialState> {
	const check = await models.checkAuth(providerId);
	if (check === undefined) {
		return { kind: "none" };
	}
	if (storedProviderIds.has(providerId)) {
		return { kind: "stored", credentialKind: credentialKindLabel(check.type) };
	}
	return { kind: "environment", source: check.source };
}

/**
 * Read the credential state of every registered model provider.
 *
 * The read is best effort per provider: a provider whose auth check fails
 * becomes an `unreadable` state instead of failing the whole command. Reports
 * come back sorted by provider id, so the output order is stable.
 */
export async function readProviderCredentialStates(
	models: Models,
	credentialStore: CredentialStore,
): Promise<ProviderCredentialReport[]> {
	const stored = await credentialStore.list();
	const storedProviderIds = new Set(stored.map((entry) => entry.providerId));

	const reports = await Promise.all(
		models.getProviders().map(async ({ id }) => {
			try {
				return {
					providerId: id,
					state: await readProviderCredentialState(
						models,
						id,
						storedProviderIds,
					),
				};
			} catch (error) {
				return {
					providerId: id,
					state: { kind: "unreadable", problem: errorMessage(error) },
				} satisfies ProviderCredentialReport;
			}
		}),
	);

	return reports.sort((left, right) =>
		left.providerId.localeCompare(right.providerId),
	);
}

/**
 * Render one credential state for the `standards auth status` output.
 *
 * The same rendering labels a provider heading in `standards models`, so both
 * commands describe a credential with the same words.
 */
export function formatProviderCredentialState(
	state: ProviderCredentialState,
): string {
	switch (state.kind) {
		case "stored":
			return `stored (${state.credentialKind})`;
		case "environment":
			return state.source === undefined
				? "environment"
				: `environment (${state.source})`;
		case "none":
			return "no credential";
		case "unreadable":
			return "credential check failed";
	}
}
