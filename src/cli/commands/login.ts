import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import {
	credentialKindLabel,
	selectProviderLoginMethod,
} from "../../credentials/login-method.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import { createTerminalLoginInteraction } from "../../credentials/terminal-login-interaction.js";
import { errorMessage } from "../../utils/errors.js";
import type { CommandContext } from "../cli-context.js";
import { formatKnownProvidersDiagnostic } from "./known-providers-diagnostic.js";

/** Store a model provider credential from the `standards login` command. */
export async function runLoginCommand(
	context: CommandContext,
	provider: string | undefined,
): Promise<number> {
	const { models } = createStandardsModels({
		authFilePath: resolveAuthFilePath({ environment: context.environment }),
	});

	const sdkProvider =
		provider === undefined ? undefined : models.getProvider(provider);
	if (provider === undefined || sdkProvider === undefined) {
		context.output.error(
			formatKnownProvidersDiagnostic("login", provider, models.getProviders()),
		);
		return 1;
	}

	const method = selectProviderLoginMethod(sdkProvider);
	if (method.kind === "ambient") {
		context.output.error(`Standards login is not available for provider '${provider}'.

Problem:
  This provider has no interactive login method. It uses ambient credentials.

Ambient credential source:
  ${method.ambientSource}

Next action:
  Provide the credential through the environment, then run the command again.`);
		return 1;
	}

	const abortController = new AbortController();
	const onInterrupt = (): void => abortController.abort();
	process.once("SIGINT", onInterrupt);
	const interaction = createTerminalLoginInteraction({
		signal: abortController.signal,
	});

	try {
		const credential = await models.login(provider, method.type, interaction);
		context.output.log(
			`Logged in to provider '${provider}' with ${credentialKindLabel(credential.type)} credentials.`,
		);
		return 0;
	} catch (error) {
		context.output.error(`Standards login failed for provider '${provider}'.

Problem:
  ${errorMessage(error)}

Next action:
  Run 'standards login ${provider}' again.`);
		return 1;
	} finally {
		process.removeListener("SIGINT", onInterrupt);
	}
}
