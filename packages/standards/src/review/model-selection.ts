import type { Models } from "@earendil-works/pi-ai";
import type { StandardsSettings } from "../settings/settings-schema.js";
import {
	type ModelReference,
	modelReferenceSchema,
	parseModelReference,
} from "./model-reference.js";

/** The two review steps that run on a selected model (specs/review.md). */
export const AGENT_STEPS = ["evaluation", "verification"] as const;

/** One review step that runs on a selected model: evaluation or verification. */
export type AgentStep = (typeof AGENT_STEPS)[number];

/**
 * Default model for each provider that Standards ships a default for.
 *
 * A step uses this model when the user selects only a provider, through its
 * credential, and gives no model reference. Providers change their model
 * lineups outside Standards releases, so a release may change these values
 * without a configuration format change (specs/review.md).
 */
export const DEFAULT_PROVIDER_MODELS: Readonly<Record<string, string>> = {
	anthropic: "claude-sonnet-5",
	openai: "gpt-5.5",
	google: "gemini-3.1-pro",
};

/**
 * Model references from the `standards review` options.
 *
 * Each field is the raw option string or undefined when the option was not
 * given. The CLI passes these; the library validates them here so an option,
 * an environment variable, and a settings field share one validation.
 */
export interface ModelSelectionOptions {
	model?: string;
	evaluationModel?: string;
	verificationModel?: string;
}

/** Everything model selection reads to resolve the model of each agent step. */
export interface ModelSelectionInputs {
	options?: ModelSelectionOptions;
	environment: NodeJS.ProcessEnv;
	settings?: StandardsSettings;
	models: Models;
}

/** The resolved model reference for each agent step. */
export interface SelectedModels {
	evaluation: ModelReference;
	verification: ModelReference;
}

/** A model selection failure carrying a human-actionable diagnostic. */
export class ModelSelectionError extends Error {
	public constructor(public readonly diagnostic: string) {
		super(diagnostic);
		this.name = "ModelSelectionError";
	}
}

/** One candidate model reference value and the source it came from. */
interface ModelSelectionCandidate {
	value: string;
	source: string;
}

/** Return the candidate model references for one step, in precedence order. */
function stepCandidates(
	step: AgentStep,
	inputs: ModelSelectionInputs,
): ModelSelectionCandidate[] {
	const options = inputs.options ?? {};
	const environment = inputs.environment;
	const settings = inputs.settings;
	const perStepOption =
		step === "evaluation" ? options.evaluationModel : options.verificationModel;
	const perStepOptionName =
		step === "evaluation" ? "--evaluation-model" : "--verification-model";
	const perStepEnvironmentName =
		step === "evaluation"
			? "STANDARDS_EVALUATION_MODEL"
			: "STANDARDS_VERIFICATION_MODEL";
	const perStepEnvironment = environment[perStepEnvironmentName];
	const perStepSettingsName =
		step === "evaluation" ? "evaluation_model" : "verification_model";
	const perStepSettings =
		step === "evaluation"
			? settings?.evaluation_model
			: settings?.verification_model;

	const candidates: (ModelSelectionCandidate | undefined)[] = [
		toCandidate(perStepOption, `the ${perStepOptionName} option`),
		toCandidate(options.model, "the --model option"),
		toCandidate(
			perStepEnvironment,
			`the ${perStepEnvironmentName} environment variable`,
		),
		toCandidate(
			environment.STANDARDS_MODEL,
			"the STANDARDS_MODEL environment variable",
		),
		toCandidate(perStepSettings, `the ${perStepSettingsName} settings field`),
		toCandidate(settings?.model, "the model settings field"),
	];
	return candidates.filter(
		(candidate): candidate is ModelSelectionCandidate =>
			candidate !== undefined,
	);
}

/** Build a candidate from a value that may be undefined or empty. */
function toCandidate(
	value: string | undefined,
	source: string,
): ModelSelectionCandidate | undefined {
	return value === undefined || value === "" ? undefined : { value, source };
}

/** Validate a candidate value as a model reference or throw a diagnostic. */
function validateCandidate(candidate: ModelSelectionCandidate): ModelReference {
	const parsed = modelReferenceSchema.safeParse(candidate.value);
	if (!parsed.success) {
		const message =
			parsed.error.issues[0]?.message ?? "Invalid model reference.";
		throw new ModelSelectionError(`Standards review could not select a model.

Problem:
  ${candidate.source} is not a valid model reference: '${candidate.value}'.

Details:
  ${message}

Next action:
  Set ${candidate.source} to a '<provider>/<model>' model reference.`);
	}
	return parsed.data;
}

/** Return the set of provider ids that have a usable credential right now. */
async function credentialedProviders(models: Models): Promise<Set<string>> {
	const providers = models.getProviders();
	const checks = await Promise.all(
		providers.map(async (provider) => ({
			id: provider.id,
			usable: (await models.checkAuth(provider.id)) !== undefined,
		})),
	);
	return new Set(
		checks.filter((check) => check.usable).map((check) => check.id),
	);
}

/**
 * Resolve the model of one step from the single provider that has a credential.
 *
 * This is the last precedence step (specs/review.md fallback 7): it applies
 * only when no option, environment variable, or settings field selected a
 * model. It fails when the credentialed provider set is empty or ambiguous.
 */
function fallbackToCredentialedProvider(
	credentialed: Set<string>,
): ModelReference {
	const providers = [...credentialed];
	const provider = providers[0];
	if (provider === undefined) {
		throw new ModelSelectionError(`Standards review could not select a model.

Problem:
  No model was selected and no provider has a usable credential.

Next action:
  Run 'standards login <provider>', or set a provider API key environment
  variable, then run the review again.`);
	}
	if (providers.length > 1) {
		const providerList = providers
			.sort((a, b) => a.localeCompare(b))
			.map((id) => `  ${id}`)
			.join("\n");
		throw new ModelSelectionError(`Standards review could not select a model.

Problem:
  More than one provider has a usable credential, so the model is ambiguous.

Providers with a credential:
${providerList}

Next action:
  Select a model with --model <provider>/<model>, or a per-step option.`);
	}
	const model = DEFAULT_PROVIDER_MODELS[provider];
	if (model === undefined) {
		throw new ModelSelectionError(`Standards review could not select a model.

Problem:
  Provider '${provider}' has a usable credential but no default model.

Next action:
  Select a model with --model ${provider}/<model>, or a per-step option.`);
	}
	return modelReferenceSchema.parse(`${provider}/${model}`);
}

/** Confirm the reference's provider has a usable credential or throw a diagnostic. */
function requireCredential(
	reference: ModelReference,
	source: string,
	credentialed: Set<string>,
): void {
	const { provider } = parseModelReference(reference);
	if (credentialed.has(provider)) {
		return;
	}
	throw new ModelSelectionError(`Standards review could not select a model.

Problem:
  ${source} names provider '${provider}', which has no usable credential.

Next action:
  Run 'standards login ${provider}', or set the provider API key environment
  variable, then run the review again.`);
}

/** Resolve the model reference for one agent step from all input sources. */
function resolveStep(
	step: AgentStep,
	inputs: ModelSelectionInputs,
	credentialed: Set<string>,
): ModelReference {
	const candidate = stepCandidates(step, inputs)[0];
	if (candidate === undefined) {
		return fallbackToCredentialedProvider(credentialed);
	}
	const reference = validateCandidate(candidate);
	requireCredential(reference, candidate.source, credentialed);
	return reference;
}

/**
 * Resolve the evaluation and verification models for one review.
 *
 * Each step resolves independently through the precedence in specs/review.md:
 * a per-step option beats a shared option, an option beats an environment
 * variable, an environment variable beats a settings field, and a credentialed
 * provider's default model is the last resort. The two steps can end on
 * different models and different providers.
 */
export async function resolveSelectedModels(
	inputs: ModelSelectionInputs,
): Promise<SelectedModels> {
	const credentialed = await credentialedProviders(inputs.models);
	return {
		evaluation: resolveStep("evaluation", inputs, credentialed),
		verification: resolveStep("verification", inputs, credentialed),
	};
}
