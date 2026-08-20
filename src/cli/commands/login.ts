import { select } from "@inquirer/prompts";
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
	const providers = models.getProviders();
	const chosenProvider = await resolveLoginProvider(
		context.interactive,
		provider,
		providers,
	);

	const sdkProvider =
		chosenProvider === undefined
			? undefined
			: models.getProvider(chosenProvider);
	if (chosenProvider === undefined || sdkProvider === undefined) {
		context.output.error(
			formatKnownProvidersDiagnostic("login", chosenProvider, providers),
		);
		return 1;
	}

	const method = selectProviderLoginMethod(sdkProvider);
	if (method.kind === "ambient") {
		context.output.error(`Standards login is not available for provider '${chosenProvider}'.

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
		const credential = await models.login(
			chosenProvider,
			method.type,
			interaction,
		);
		context.output.log(
			`Logged in to provider '${chosenProvider}' with ${credentialKindLabel(credential.type)} credentials.`,
		);
		return 0;
	} catch (error) {
		context.output.error(`Standards login failed for provider '${chosenProvider}'.

Problem:
  ${errorMessage(error)}

Next action:
  Run 'standards login ${chosenProvider}' again.`);
		return 1;
	} finally {
		process.removeListener("SIGINT", onInterrupt);
	}
}

/**
 * Resolve the provider to log in with (specs/cli.md login).
 *
 * A provider passed on the command line wins. Without one, an interactive
 * terminal picks from the known providers; anything else resolves to no
 * provider, so the caller prints the known-providers diagnostic.
 */
export async function resolveLoginProvider(
	interactive: boolean,
	provided: string | undefined,
	providers: readonly { id: string }[],
): Promise<string | undefined> {
	if (provided !== undefined) {
		return provided;
	}
	if (interactive && providers.length > 0) {
		return select({
			message: "Choose a provider to log in:",
			choices: providers.map(({ id }) => ({ name: id, value: id })),
		});
	}
	return undefined;
}
