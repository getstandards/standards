import {
	type ChangeScope,
	ConfigurationResolutionError,
	createImportProgressReporter,
	filterRuleSet,
	formatStandardsSettingsDiagnostic,
	loadRules,
	ModelSelectionError,
	openRunGitSourceStore,
	type Resolution,
	ReviewInputError,
	type ReviewModels,
	ReviewProviderError,
	type ReviewReport,
	ReviewRuleFilterError,
	ReviewTargetError,
	readStandardsSettingsFile,
	resolveChangeScope,
	resolveStandardsSettingsPath,
	runReview,
	type StandardsSettings,
	StandardsSettingsLoadError,
} from "@getstandards/core";
import type { StandardsCommandArgs } from "./command-args.js";

/**
 * One thing a running review is doing now, for the progress panel.
 *
 * A step phase carries its finished and total invocation counts, so a host can
 * draw a proportional bar. Every other phase carries one line of detail.
 */
export type ReviewProgress =
	| { phase: "resolving"; detail: string }
	| { phase: "planning"; detail: string }
	| { phase: "evaluation" | "verification"; completed: number; total: number };

/** Everything one `/standards` run needs from its host, and nothing from pi. */
export interface ReviewHost {
	/** The directory pi runs in; the review reads its Git repository. */
	cwd: string;
	/** The models runtime the review calls, built over pi's model registry. */
	models: ReviewModels;
	/**
	 * The model reference of pi's active model, in `<provider>/<model>` form.
	 *
	 * It selects the review models only when nothing else does, so a team that
	 * wants parity with CI sets the model in settings instead.
	 */
	activeModel?: string;
	environment: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	/** Receives what the review is doing now. */
	reportProgress?: (progress: ReviewProgress) => void;
}

/** What one `/standards` run produced: a report, or a reason it could not run. */
export type StandardsReviewOutcome =
	| { kind: "report"; report: ReviewReport }
	| { kind: "diagnostic"; diagnostic: string };

/**
 * Run one review from inside a host process (specs/pi.md).
 *
 * It resolves the change scope, the rules, and the models, runs the review, and
 * returns the report. A review with blocking findings is a completed review, so
 * every failure that is not a finding comes back as a diagnostic the host
 * renders.
 */
export async function runStandardsReview(
	host: ReviewHost,
	args: StandardsCommandArgs,
): Promise<StandardsReviewOutcome> {
	let settings: StandardsSettings | undefined;
	try {
		settings = await readStandardsSettingsFile(
			resolveStandardsSettingsPath({ environment: host.environment }),
		);
	} catch (error) {
		if (error instanceof StandardsSettingsLoadError) {
			return {
				kind: "diagnostic",
				diagnostic: formatStandardsSettingsDiagnostic(error),
			};
		}
		throw error;
	}

	let scope: ChangeScope;
	try {
		scope = await resolveChangeScope(host.cwd, args);
	} catch (error) {
		return { kind: "diagnostic", diagnostic: describeFailure(error) };
	}

	const reportResolving = (detail: string) =>
		host.reportProgress?.({ phase: "resolving", detail });
	const gitSourceStore = await openRunGitSourceStore({
		environment: host.environment,
		settingsCacheDir: settings?.cache_dir,
		reportCacheFallback: reportResolving,
	});
	let resolution: Resolution;
	try {
		reportResolving("Reading .standards.yml");
		const loaded = await loadRules(host.cwd, {
			gitSourceStore,
			reportProgress: createImportProgressReporter(reportResolving),
		});
		resolution = {
			...loaded,
			rules: filterRuleSet(loaded.rules, {
				rule: args.rule,
				folder: args.folder,
			}),
		};
	} catch (error) {
		return { kind: "diagnostic", diagnostic: describeFailure(error) };
	} finally {
		await gitSourceStore.dispose();
	}

	try {
		const report = await runReview({
			scope,
			workingDirectory: host.cwd,
			targets: args.targets,
			resolution,
			models: host.models,
			modelOptions: resolveModelOptions(host, args, settings),
			environment: host.environment,
			settings,
			reportProgress: (detail) =>
				host.reportProgress?.({ phase: "planning", detail }),
			reportStepProgress: (progress) =>
				host.reportProgress?.({
					phase: progress.step,
					completed: progress.completed,
					total: progress.total,
				}),
			signal: host.signal,
		});
		return { kind: "report", report };
	} catch (error) {
		return { kind: "diagnostic", diagnostic: describeFailure(error) };
	}
}

/**
 * Resolve the model options one review runs with (specs/pi.md model selection).
 *
 * A `/standards` option, a `STANDARDS_*` variable, or a settings field keeps the
 * review on the model CI uses. Only when none of them selects a model does the
 * review fall back to pi's active model, so a review needs no extra setup.
 */
function resolveModelOptions(
	host: ReviewHost,
	args: StandardsCommandArgs,
	settings: StandardsSettings | undefined,
): { model?: string; evaluationModel?: string; verificationModel?: string } {
	const selected =
		args.model !== undefined ||
		args.evaluationModel !== undefined ||
		args.verificationModel !== undefined ||
		host.environment.STANDARDS_MODEL !== undefined ||
		host.environment.STANDARDS_EVALUATION_MODEL !== undefined ||
		host.environment.STANDARDS_VERIFICATION_MODEL !== undefined ||
		settings?.model !== undefined ||
		settings?.evaluation_model !== undefined ||
		settings?.verification_model !== undefined;

	if (selected) {
		return {
			model: args.model,
			evaluationModel: args.evaluationModel,
			verificationModel: args.verificationModel,
		};
	}
	return { model: host.activeModel };
}

/**
 * Describe one review failure as a diagnostic with a problem and a next action.
 *
 * The two expected cases are a missing entry file, which resolution reports,
 * and a selected model with no configured authentication in pi, which model
 * selection reports. Both already carry their own diagnostic text.
 */
function describeFailure(error: unknown): string {
	if (
		error instanceof ModelSelectionError ||
		error instanceof ReviewRuleFilterError ||
		error instanceof ReviewInputError
	) {
		return error.message;
	}
	if (error instanceof ConfigurationResolutionError) {
		return `Standards review could not run.

Problem:
  ${error.message}

Next action:
  Fix '.standards.yml' at the repository root, then run '/standards' again.`;
	}
	if (error instanceof ReviewTargetError) {
		return `Standards review could not run.

Problem:
  ${error.message}

Next action:
  Give a target path that exists in ${error.place}.`;
	}
	if (error instanceof ReviewProviderError) {
		return `Standards review failed and reports no conclusion.

Problem:
  The ${error.step} step failed on ${error.provider}/${error.model}: ${error.providerMessage}

Next action:
  Fix the provider problem, then run '/standards' again.`;
	}
	return `Standards review failed and reports no conclusion.

Problem:
  ${error instanceof Error ? error.message : String(error)}

Next action:
  Fix the problem, then run '/standards' again.`;
}
