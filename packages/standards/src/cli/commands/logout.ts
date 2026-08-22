import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import { credentialKindLabel } from "../../credentials/login-method.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import type { CommandContext } from "../cli-context.js";
import { formatKnownProvidersDiagnostic } from "./known-providers-diagnostic.js";

/** Remove a stored model provider credential from the `standards auth logout` command. */
export async function runLogoutCommand(
	context: CommandContext,
	provider: string | undefined,
): Promise<number> {
	const { models, credentialStore } = createStandardsModels({
		authFilePath: resolveAuthFilePath({ environment: context.environment }),
	});

	if (provider === undefined || models.getProvider(provider) === undefined) {
		context.output.error(
			formatKnownProvidersDiagnostic(
				"auth logout",
				provider,
				models.getProviders(),
			),
		);
		return 1;
	}

	const stored = (await credentialStore.list()).find(
		(entry) => entry.providerId === provider,
	);
	if (stored === undefined) {
		context.output.log(`No credential is stored for provider '${provider}'.`);
		return 0;
	}

	await models.logout(provider);
	context.output.log(
		`Removed the ${credentialKindLabel(stored.type)} credential for provider '${provider}'.`,
	);
	return 0;
}
