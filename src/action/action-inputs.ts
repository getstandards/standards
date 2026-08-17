import { z } from "zod/v4";

/** Inputs accepted by the Standards GitHub Action. */
export const actionInputsSchema = z.object({
	anthropicApiKey: z.string().min(1).optional(),
	githubToken: z
		.string({ error: "A GitHub token is required." })
		.min(1, "A GitHub token is required."),
});

/** Validated inputs accepted by the Standards GitHub Action. */
export type ActionInputs = z.infer<typeof actionInputsSchema>;

/** Return the first non-empty value from a list of environment variables. */
function readFirstEnvironmentValue(
	environment: NodeJS.ProcessEnv,
	names: string[],
): string | undefined {
	for (const name of names) {
		const value = environment[name];
		if (value !== undefined && value !== "") {
			return value;
		}
	}
	return undefined;
}

/** Parse and validate GitHub Action inputs from environment variables. */
export function parseActionInputs(
	environment: NodeJS.ProcessEnv = process.env,
): ActionInputs {
	return actionInputsSchema.parse({
		anthropicApiKey: readFirstEnvironmentValue(environment, [
			"INPUT_ANTHROPIC_API_KEY",
			"ANTHROPIC_API_KEY",
			"CLAUDE_CODE_OAUTH_TOKEN",
		]),
		githubToken: readFirstEnvironmentValue(environment, [
			"INPUT_GITHUB_TOKEN",
			"GITHUB_TOKEN",
		]),
	});
}
