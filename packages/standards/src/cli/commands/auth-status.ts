import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import {
	formatProviderCredentialState,
	hasUsableCredential,
	type ProviderCredentialReport,
	readProviderCredentialStates,
} from "../../credentials/provider-credential-state.js";
import { errorMessage } from "../../utils/errors.js";
import type { CommandContext } from "../cli-context.js";

/** `auth status` is a checking command: it exits with 2 when it could not run. */
const AUTH_STATUS_ERROR_STATUS = 2;

/** Align the provider id column of the credential lines. */
function formatCredentialLines(
	reports: readonly ProviderCredentialReport[],
): string[] {
	const width = Math.max(...reports.map(({ providerId }) => providerId.length));

	return reports.map(({ providerId, state }) => {
		const line = `  ${providerId.padEnd(width)}  ${formatProviderCredentialState(state)}`;
		// The problem names the reason the check failed; without it the user
		// cannot fix an unknown state (specs/cli.md auth status).
		return state.kind === "unreadable" ? `${line}: ${state.problem}` : line;
	});
}

/**
 * Report the credential state of each model provider (`standards auth status`).
 *
 * The command is read only: it never writes the configuration, the lock file,
 * or a credential. It exits with status `0` when at least one provider has a
 * usable credential, `1` when none has, and `2` when it could not run
 * (specs/cli.md exit statuses).
 */
export async function runAuthStatusCommand(
	context: CommandContext,
): Promise<number> {
	let reports: ProviderCredentialReport[];
	try {
		const { models, credentialStore } = createStandardsModels({
			authFilePath: resolveAuthFilePath({ environment: context.environment }),
		});
		reports = await readProviderCredentialStates(models, credentialStore);
	} catch (error) {
		context.output.error(`Standards auth status could not run.

Problem:
  ${errorMessage(error)}

Next action:
  Verify the credential file, then run 'standards auth status' again.`);
		return AUTH_STATUS_ERROR_STATUS;
	}

	const usable = reports.filter(hasUsableCredential);
	const unreadable = reports.filter(({ state }) => state.kind === "unreadable");

	const lines =
		usable.length === 0
			? ["No provider has a usable credential."]
			: [
					"Provider credentials:",
					"",
					...formatCredentialLines(usable),
					"",
					`${usable.length} of ${reports.length} providers have a usable credential.`,
				];

	// A provider whose check failed is not counted as usable, but staying
	// silent about it would read as "no credential" and mislead the user
	// (specs/cli.md auth status).
	if (unreadable.length > 0) {
		lines.push(
			"",
			"Could not check:",
			"",
			...formatCredentialLines(unreadable),
		);
	}

	if (usable.length === 0) {
		lines.push(
			"",
			"Next action:",
			"  Run 'standards auth login <provider>' to store a provider credential.",
		);
	}

	context.output.log(lines.join("\n"));
	return usable.length === 0 ? 1 : 0;
}
