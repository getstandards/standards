import type { Api, Model, ModelCost, Models } from "@earendil-works/pi-ai";
import type { Resolution } from "../rules/rules-loader.js";
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
	type CostBasis,
	type ReviewCounts,
	type ReviewReport,
} from "./review-report.js";
import {
	filterChangedFilesByTargets,
	normalizeTarget,
	validateTargets,
} from "./review-target.js";
import { selectRules } from "./rule-selection.js";
import type { ReviewStepProgress } from "./step-progress.js";
import { runVerification } from "./verification-step.js";

/** Everything one review needs to run end to end (specs/review.md). */
export interface RunReviewInput {
	/** The commit the change is compared against, or the empty tree for a full review. */
	baseRevision: string;
	/** The commit that contains the change, checked out on disk. */
	headRevision: string;
	/** The head checkout directory, which Git and the agents read. */
	workingDirectory: string;
	/** Repository-relative paths that limit the review. Empty means the whole change. */
	targets?: readonly string[];
	/** The resolution: the ordered rules, resolved Git commits, and warnings. */
	resolution: Resolution;
	/** The SDK model collection that runs the agent steps. */
	models: Models;
	/** Model references from the `standards review` options, when given. */
	modelOptions?: ModelSelectionOptions;
	environment: NodeJS.ProcessEnv;
	settings?: StandardsSettings;
	/** Receives the selected file and task counts before the evaluation step. */
	reportProgress?: (line: string) => void;
	/** Receives the live invocation counts of each agent step it runs. */
	reportStepProgress?: (progress: ReviewStepProgress) => void;
	/** Receives detailed progress for the `--verbose` option (specs/cli.md). */
	reportVerbose?: (line: string) => void;
	signal?: AbortSignal;
}

/**
 * Run one review and return its report (specs/review.md pipeline).
 *
 * It resolves the models, computes the change, discards changed files that no
 * target matches, selects rules, plans tasks, evaluates, verifies, and renders
 * the report. A target that does not exist in the head revision and matches no
 * deleted file throws ReviewTargetError. An empty selection ends the
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
	const evaluationModel = resolveStepModel(
		input.models,
		selectedModels.evaluation,
	);
	const verificationModel = resolveStepModel(
		input.models,
		selectedModels.verification,
	);
	const costBasis = await resolveCostBasis(input.models, [
		evaluationModel,
		verificationModel,
	]);

	const allChangedFiles = await computeChange({
		baseRevision: input.baseRevision,
		headRevision: input.headRevision,
		workingDirectory: input.workingDirectory,
	});
	const targets = (input.targets ?? []).map(normalizeTarget);
	if (targets.length > 0) {
		await validateTargets({
			targets,
			headRevision: input.headRevision,
			workingDirectory: input.workingDirectory,
			changedFiles: allChangedFiles,
		});
	}
	const changedFiles = filterChangedFilesByTargets(allChangedFiles, targets);
	const reportVerbose = input.reportVerbose;
	if (reportVerbose !== undefined) {
		reportVerbose(`Base revision: ${input.baseRevision}`);
		reportVerbose(`Head revision: ${input.headRevision}`);
		if (targets.length > 0) {
			reportVerbose(`Targets: ${targets.join(", ")}`);
		}
	}
	const ruleSet = input.resolution.rules;
	const selections = selectRules(ruleSet, changedFiles);
	if (reportVerbose !== undefined) {
		for (const selection of selections) {
			const ruleIds = selection.rules.map((rule) => rule.id).join(", ");
			reportVerbose(
				`Selected ${selection.file.path} (${selection.file.status}): ${ruleIds}`,
			);
		}
	}

	const selectedRuleIds = new Set(
		selections.flatMap((selection) => selection.rules.map((rule) => rule.id)),
	);
	const baseCounts: Pick<ReviewCounts, "resolved_rules" | "selected_rules"> = {
		resolved_rules: ruleSet.length,
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
			costBasis,
			confirmedFindings: [],
			ruleSet,
			sources: input.resolution.gitSources,
			warnings: input.resolution.warnings,
		});
	}

	const tasks = planEvaluationTasks(selections);
	if (reportVerbose !== undefined) {
		tasks.forEach((task, index) => {
			const ruleIds = [
				...new Set(
					task.files.flatMap((file) => file.rules.map((rule) => rule.id)),
				),
			];
			reportVerbose(
				`Evaluation task ${index + 1}/${tasks.length}: ${task.files
					.map((file) => file.file.path)
					.join(", ")} (rules: ${ruleIds.join(", ")})`,
			);
		});
	}
	input.reportProgress?.(
		`Evaluating ${selections.length} selected file${
			selections.length === 1 ? "" : "s"
		} in ${tasks.length} evaluation task${tasks.length === 1 ? "" : "s"}.`,
	);
	const evaluation = await runEvaluation({
		models: input.models,
		model: evaluationModel,
		tasks,
		headCheckoutDir: input.workingDirectory,
		reportVerbose: input.reportVerbose,
		reportStepProgress: input.reportStepProgress,
		signal: input.signal,
	});

	const verification = await runVerification({
		models: input.models,
		model: verificationModel,
		findings: evaluation.findings,
		ruleSet,
		headCheckoutDir: input.workingDirectory,
		reportVerbose: input.reportVerbose,
		reportStepProgress: input.reportStepProgress,
		signal: input.signal,
	});

	return buildReviewReport({
		models: selectedModels,
		counts: { ...baseCounts, evaluation_tasks: tasks.length },
		usage: {
			evaluation: evaluation.usage,
			verification: verification.usage,
		},
		costBasis,
		confirmedFindings: verification.findings,
		ruleSet,
		sources: input.resolution.gitSources,
		warnings: input.resolution.warnings,
	});
}

/**
 * Resolve what the review's cost number means (specs/review.md step 5).
 *
 * `Model.cost` holds the API list price. When every step model's rates are
 * zero, the cost carries no information. When a step provider's credential is
 * an OAuth subscription, the tokens are not charged per token, so the cost is
 * an estimate at the API list price. Otherwise an API key credential pays it.
 */
async function resolveCostBasis(
	models: Models,
	stepModels: readonly Model<Api>[],
): Promise<CostBasis> {
	if (stepModels.every((model) => isZeroCost(model.cost))) {
		return "none";
	}
	const providers = [...new Set(stepModels.map((model) => model.provider))];
	const checks = await Promise.all(
		providers.map((provider) => models.checkAuth(provider)),
	);
	return checks.some((check) => check?.type === "oauth")
		? "list_price_estimate"
		: "charged";
}

/** True when every rate of a model's cost, including its tiers, is zero. */
function isZeroCost(cost: ModelCost): boolean {
	return [cost, ...(cost.tiers ?? [])].every(
		(rates) =>
			rates.input === 0 &&
			rates.output === 0 &&
			rates.cacheRead === 0 &&
			rates.cacheWrite === 0,
	);
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
