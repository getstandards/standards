import { z } from "zod/v4";

/** An environment variable name, as `provider-env` accepts it. */
const environmentVariableName = z
	.string()
	.regex(
		/^[A-Z_][A-Z0-9_]*$/,
		"A provider-env entry must be an environment variable name, such as OPENROUTER_API_KEY.",
	);

/** Inputs accepted by the Standards GitHub Action (specs/github.md). */
export const actionInputsSchema = z.object({
	githubToken: z
		.string({ error: "A GitHub token is required." })
		.min(1, "A GitHub token is required."),
	anthropicApiKey: z.string().min(1).optional(),
	openaiApiKey: z.string().min(1).optional(),
	googleApiKey: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	evaluationModel: z.string().min(1).optional(),
	verificationModel: z.string().min(1).optional(),
	providerEnv: z.array(environmentVariableName),
});

/** Validated inputs accepted by the Standards GitHub Action. */
export type ActionInputs = z.infer<typeof actionInputsSchema>;

/**
 * Read one action input from the environment.
 *
 * A Node action receives the input `github-token` as the environment
 * variable `INPUT_GITHUB-TOKEN`: the runner uppercases the name and keeps
 * the hyphens. An empty value means the input was not given.
 */
function readInput(
	environment: NodeJS.ProcessEnv,
	name: string,
): string | undefined {
	const value = environment[`INPUT_${name.toUpperCase()}`];
	return value === undefined || value === "" ? undefined : value;
}

/** Split a `provider-env` value into variable names. */
function splitProviderEnv(value: string | undefined): string[] {
	if (value === undefined) {
		return [];
	}
	return value.split(/[\s,]+/).filter((name) => name !== "");
}

/** Parse and validate GitHub Action inputs from environment variables. */
export function parseActionInputs(
	environment: NodeJS.ProcessEnv = process.env,
): ActionInputs {
	return actionInputsSchema.parse({
		githubToken: readInput(environment, "github-token"),
		anthropicApiKey: readInput(environment, "anthropic-api-key"),
		openaiApiKey: readInput(environment, "openai-api-key"),
		googleApiKey: readInput(environment, "google-api-key"),
		model: readInput(environment, "model"),
		evaluationModel: readInput(environment, "evaluation-model"),
		verificationModel: readInput(environment, "verification-model"),
		providerEnv: splitProviderEnv(readInput(environment, "provider-env")),
	});
}

/**
 * The environment variables of the principal providers
 * (specs/credentials.md). Each named action input forwards to one of them.
 */
export const PRINCIPAL_PROVIDER_VARIABLES = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
] as const;

/** The environment one review run reads, and the variables it may read. */
export interface ReviewEnvironment {
	environment: NodeJS.ProcessEnv;
	/** The provider credential variables the automation auth context exposes. */
	allowedEnvironmentVariables: string[];
	/** True when at least one allowed variable holds a credential. */
	hasCredential: boolean;
}

/**
 * Build the environment forwarded to the review (specs/github.md inputs).
 *
 * Each input maps to one environment variable; the action adds no precedence
 * of its own. A variable named in `provider-env` is copied from the step
 * environment. Nothing else from the runner environment reaches the review,
 * so an ambient credential on a self-hosted runner is never used silently.
 */
export function buildReviewEnvironment(
	inputs: ActionInputs,
	environment: NodeJS.ProcessEnv,
): ReviewEnvironment {
	const review: NodeJS.ProcessEnv = {};
	if (inputs.anthropicApiKey !== undefined) {
		review.ANTHROPIC_API_KEY = inputs.anthropicApiKey;
	}
	if (inputs.openaiApiKey !== undefined) {
		review.OPENAI_API_KEY = inputs.openaiApiKey;
	}
	if (inputs.googleApiKey !== undefined) {
		review.GEMINI_API_KEY = inputs.googleApiKey;
	}
	if (inputs.model !== undefined) {
		review.STANDARDS_MODEL = inputs.model;
	}
	if (inputs.evaluationModel !== undefined) {
		review.STANDARDS_EVALUATION_MODEL = inputs.evaluationModel;
	}
	if (inputs.verificationModel !== undefined) {
		review.STANDARDS_VERIFICATION_MODEL = inputs.verificationModel;
	}
	for (const name of inputs.providerEnv) {
		const value = environment[name];
		if (value !== undefined && value !== "") {
			review[name] = value;
		}
	}
	const allowedEnvironmentVariables = [
		...PRINCIPAL_PROVIDER_VARIABLES,
		...inputs.providerEnv,
	];
	const hasCredential = allowedEnvironmentVariables.some((name) => {
		const value = review[name];
		return value !== undefined && value !== "";
	});
	return { environment: review, allowedEnvironmentVariables, hasCredential };
}
