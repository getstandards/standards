import {
	type ChangeScope,
	createImportProgressReporter,
	filterRuleSet,
	loadRules,
	ModelSelectionError,
	openRunGitSourceStore,
	type Resolution,
	ReviewProviderError,
	type ReviewReport,
	ReviewRuleFilterError,
	ReviewTargetError,
	resolveChangeScope,
	runReview,
} from "@getstandards/core";
import { errorMessage } from "@getstandards/core/internal";
import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import type { ReviewCliArgs } from "../cli-args.js";
import type { CommandContext } from "../cli-context.js";
import {
	renderReviewReportTerminal,
	renderReviewReportText,
} from "./review-report-text.js";
import { createReviewSpinner, formatStepProgress } from "./review-spinner.js";
import { renderVerboseLineTerminal } from "./review-verbose.js";
import { formatValidationError } from "./validate-diagnostic.js";

/**
 * Run the review pipeline for the repository in the working directory
 * (specs/cli.md review).
 *
 * As a checking command it exits with status 0 for a compliant conclusion,
 * 1 for a non-compliant conclusion, and 2 when the review could not run or
 * complete. The report goes to standard output; progress and diagnostics go
 * to standard error.
 */
export async function runReviewCommand(
	context: CommandContext,
	options: ReviewCliArgs,
): Promise<number> {
	const { workingDirectory, output, environment, settings } = context;

	let scope: ChangeScope;
	try {
		scope = await resolveChangeScope(workingDirectory, options);
	} catch (error) {
		output.error(errorMessage(error));
		return 2;
	}

	const gitSourceStore = await openRunGitSourceStore({
		cacheDir: context.cacheDir,
		settingsCacheDir: settings?.cache_dir,
		noCache: context.noCache,
		environment,
		reportCacheFallback: (message) => output.error(message),
	});
	const reportImportProgress = createImportProgressReporter((line) =>
		output.error(line),
	);
	let loaded: Resolution;
	try {
		loaded = await loadRules(workingDirectory, {
			gitSourceStore,
			reportProgress: reportImportProgress,
		});
	} catch (error) {
		output.error(await formatValidationError(error, workingDirectory));
		return 2;
	} finally {
		await gitSourceStore.dispose();
	}

	// '--rule' and '--folder' shrink the rule set before the pipeline runs, so
	// the report's resolved_rules count reflects the filtered set.
	let resolution: Resolution;
	try {
		resolution = {
			...loaded,
			rules: filterRuleSet(loaded.rules, {
				rule: options.rule,
				folder: options.folder,
			}),
		};
	} catch (error) {
		output.error(
			error instanceof ReviewRuleFilterError
				? error.diagnostic
				: errorMessage(error),
		);
		return 2;
	}

	const { models } = createStandardsModels({
		authFilePath: resolveAuthFilePath({ environment }),
	});

	// On an interactive terminal, a spinner on standard error shows that the
	// review is working while the evaluation and verification steps run. The
	// progress and verbose lines print above it.
	const spinner =
		context.interactive && process.stderr.isTTY
			? createReviewSpinner(process.stderr)
			: undefined;
	const printProgress = (line: string) => {
		if (spinner === undefined) {
			output.error(line);
		} else {
			spinner.printLine(line);
		}
	};

	let report: ReviewReport;
	try {
		report = await runReview({
			scope,
			workingDirectory,
			targets: options.targets,
			resolution,
			models,
			modelOptions: {
				model: options.model,
				evaluationModel: options.evaluationModel,
				verificationModel: options.verificationModel,
			},
			environment,
			settings,
			reportProgress: printProgress,
			reportStepProgress:
				spinner === undefined
					? undefined
					: (progress) => spinner.update(formatStepProgress(progress)),
			reportVerbose: options.verbose
				? (line) =>
						printProgress(
							context.interactive ? renderVerboseLineTerminal(line) : line,
						)
				: undefined,
		});
	} catch (error) {
		// Erase the spinner line before the diagnostic prints.
		spinner?.stop();
		output.error(formatReviewFailure(error));
		return 2;
	}
	spinner?.stop();
	if (options.format === "json") {
		output.log(JSON.stringify(report, undefined, "\t"));
	} else if (context.interactive) {
		output.log(renderReviewReportTerminal(report));
	} else {
		output.log(renderReviewReportText(report));
	}
	return report.conclusion === "compliant" ? 0 : 1;
}

/** Format a review failure; a failed review reports no conclusion. */
export function formatReviewFailure(error: unknown): string {
	if (error instanceof ModelSelectionError) {
		return error.diagnostic;
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
  Fix the provider problem, then run 'standards review' again.`;
	}
	return `Standards review failed and reports no conclusion.

Problem:
  ${errorMessage(error)}

Next action:
  Fix the problem, then run 'standards review' again.`;
}
