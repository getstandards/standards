import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { Rule } from "../config/index.js";
import type { StandardsSettings } from "../settings/settings-schema.js";
import { emptyStepUsage } from "./agent-usage.js";
import { computeChange } from "./change-diff.js";
import { planEvaluationTasks } from "./evaluation-plan.js";
import { runEvaluation } from "./evaluation-step.js";
import { type ModelReference, parseModelReference } from "./model-reference.js";
import {
	type ModelSelectionOptions,
	resolveSelectedModels,
} from "./model-selection.js";
import {
	buildReviewReport,
	type ReviewCounts,
	type ReviewReport,
} from "./review-report.js";
import { selectRules } from "./rule-selection.js";
import { runVerification } from "./verification-step.js";

/** Everything one review needs to run end to end (specs/review.md). */
export interface RunReviewInput {
	/** The commit the change is compared against, or the empty tree for a full review. */
	baseRevision: string;
	/** The commit that contains the change, checked out on disk. */
	headRevision: string;
	/** The head checkout directory, which Git and the agents read. */
	workingDirectory: string;
	/** The ordered rule set produced by resolution. */
	ruleSet: readonly Rule[];
	/** The SDK model collection that runs the agent steps. */
	models: Models;
	/** Model references from the `standards review` options, when given. */
	modelOptions?: ModelSelectionOptions;
	environment: NodeJS.ProcessEnv;
	settings?: StandardsSettings;
	signal?: AbortSignal;
}

/**
 * Run one review and return its report (specs/review.md pipeline).
 *
 * It resolves the models, computes the change, selects rules, plans tasks,
 * evaluates, verifies, and renders the report. An empty selection ends the
 * review with a compliant conclusion and zero model invocations. A provider
 * failure throws ReviewProviderError, so the review never reports a conclusion
 * from a change it did not fully evaluate.
 */
export async function runReview(input: RunReviewInput): Promise<ReviewReport> {
	const selectedModels = await resolveSelectedModels({
		options: input.modelOptions,
		environment: input.environment,
		settings: input.settings,
		models: input.models,
	});

	const changedFiles = await computeChange({
		baseRevision: input.baseRevision,
		headRevision: input.headRevision,
		workingDirectory: input.workingDirectory,
	});
	const selections = selectRules(input.ruleSet, changedFiles);

	const selectedRuleIds = new Set(
		selections.flatMap((selection) => selection.rules.map((rule) => rule.id)),
	);
	const baseCounts: Pick<ReviewCounts, "resolved_rules" | "selected_rules"> = {
		resolved_rules: input.ruleSet.length,
		selected_rules: selectedRuleIds.size,
	};

	if (selections.length === 0) {
		return buildReviewReport({
			models: selectedModels,
			counts: { ...baseCounts, evaluation_tasks: 0 },
			usage: {
				evaluation: emptyStepUsage(),
				verification: emptyStepUsage(),
			},
			confirmedFindings: [],
			ruleSet: input.ruleSet,
		});
	}

	const tasks = planEvaluationTasks(selections);
	const evaluationModel = resolveStepModel(
		input.models,
		selectedModels.evaluation,
	);
	const verificationModel = resolveStepModel(
		input.models,
		selectedModels.verification,
	);

	const evaluation = await runEvaluation({
		models: input.models,
		model: evaluationModel,
		tasks,
		headCheckoutDir: input.workingDirectory,
		signal: input.signal,
	});
	const verification = await runVerification({
		models: input.models,
		model: verificationModel,
		findings: evaluation.findings,
		ruleSet: input.ruleSet,
		headCheckoutDir: input.workingDirectory,
		signal: input.signal,
	});

	return buildReviewReport({
		models: selectedModels,
		counts: { ...baseCounts, evaluation_tasks: tasks.length },
		usage: {
			evaluation: evaluation.usage,
			verification: verification.usage,
		},
		confirmedFindings: verification.findings,
		ruleSet: input.ruleSet,
	});
}

/** Resolve a model reference to the SDK model, or fail with a clear diagnostic. */
function resolveStepModel(
	models: Models,
	reference: ModelReference,
): Model<Api> {
	const { provider, model } = parseModelReference(reference);
	const resolved = models.getModel(provider, model);
	if (resolved === undefined) {
		throw new Error(
			`Standards review could not find model '${model}' from provider '${provider}'. ` +
				"Check the model reference against the provider's model list.",
		);
	}
	return resolved;
}
