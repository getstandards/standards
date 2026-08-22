import type { Provider } from "@earendil-works/pi-ai";

/**
 * Format the diagnostic shown when a command runs without a provider or with
 * an unknown provider. It lists the known provider ids so the user can pick a
 * valid one.
 *
 * `command` is the complete command name after `standards`, such as
 * `auth login`, so the next action is a line the user can run as it is.
 */
export function formatKnownProvidersDiagnostic(
	command: "auth login" | "auth logout" | "models",
	provider: string | undefined,
	providers: readonly Provider[],
): string {
	const problem =
		provider === undefined
			? `Command '${command}' requires a provider.`
			: `Unknown provider '${provider}'.`;
	const knownProviderIds = providers
		.map((entry) => entry.id)
		.sort((a, b) => a.localeCompare(b));

	return `Standards ${command} could not run.

Problem:
  ${problem}

Known providers:
${knownProviderIds.map((id) => `  ${id}`).join("\n")}

Next action:
  Run 'standards ${command} <provider>' with a known provider.`;
}
