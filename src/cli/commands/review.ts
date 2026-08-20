import { openRunGitSourceStore } from "../../cache/git-source-cache.js";
import { createImportProgressReporter } from "../../cache/import-progress.js";
import { loadRules } from "../../config/configuration-resolver.js";
import type { Rule } from "../../config/index.js";
import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import { ModelSelectionError } from "../../review/model-selection.js";
import { ReviewProviderError } from "../../review/review-agent.js";
import type { ReviewReport } from "../../review/review-report.js";
import { ReviewTargetError } from "../../review/review-target.js";
import { runReview } from "../../review/run-review.js";
import { errorMessage } from "../../utils/errors.js";
import { runGit } from "../../utils/git.js";
import type { ReviewCliArgs } from "../cli-args.js";
import type { CommandContext } from "../cli-context.js";
import {
	renderReviewReportTerminal,
	renderReviewReportText,
} from "./review-report-text.js";
import { createReviewSpinner, formatStepProgress } from "./review-spinner.js";
import { renderVerboseLineTerminal } from "./review-verbose.js";
import { formatValidationError } from "./validate-diagnostic.js";

/** The review could not run: its diagnostic is ready to print (specs/cli.md). */
class ReviewInputError extends Error {
	public constructor(diagnostic: string) {
		super(diagnostic);
		this.name = "ReviewInputError";
	}
}

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

	let baseRevision: string;
	let headRevision: string;
	try {
		({ baseRevision, headRevision } = await resolveReviewRevisions(
			workingDirectory,
			options,
		));
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
	let ruleSet: Rule[];
	try {
		ruleSet = await loadRules(workingDirectory, {
			gitSourceStore,
			reportProgress: reportImportProgress,
		});
	} catch (error) {
		output.error(await formatValidationError(error, workingDirectory));
		return 2;
	} finally {
		await gitSourceStore.dispose();
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
			baseRevision,
			headRevision,
			workingDirectory,
			targets: options.targets,
			ruleSet,
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
	output.log(
		options.format === "json"
			? JSON.stringify(report, undefined, "\t")
			: context.interactive
				? renderReviewReportTerminal(report)
				: renderReviewReportText(report),
	);
	return report.conclusion === "compliant" ? 0 : 1;
}

/** The resolved base and head commits of one review (specs/cli.md review). */
interface ReviewRevisions {
	baseRevision: string;
	headRevision: string;
}

/**
 * Resolve the head and base revisions (specs/cli.md review).
 *
 * The head revision is the checkout's HEAD. The base revision is the empty
 * tree with `--all`, the `--base` revision when given, and the merge base of
 * HEAD and the remote default branch otherwise.
 */
async function resolveReviewRevisions(
	workingDirectory: string,
	options: ReviewCliArgs,
): Promise<ReviewRevisions> {
	let headRevision: string;
	try {
		headRevision = await runGit(
			["rev-parse", "--verify", "HEAD"],
			workingDirectory,
		);
	} catch (error) {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the head revision HEAD: ${errorMessage(error)}

Next action:
  Run 'standards review' inside a Git repository with at least one commit.`);
	}

	if (options.all) {
		// The hash of the empty tree, computed so it matches the repository's
		// object format (SHA-1 or SHA-256).
		const emptyTree = await runGit(
			["hash-object", "-t", "tree", "/dev/null"],
			workingDirectory,
		);
		return { baseRevision: emptyTree, headRevision };
	}

	if (options.base !== undefined) {
		try {
			const baseRevision = await runGit(
				["rev-parse", "--verify", `${options.base}^{commit}`],
				workingDirectory,
			);
			return { baseRevision, headRevision };
		} catch (error) {
			throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the base revision '${options.base}': ${errorMessage(error)}

Next action:
  Give --base a revision that Git can resolve in this repository.`);
		}
	}

	try {
		const remoteDefaultBranch = await runGit(
			["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
			workingDirectory,
		);
		const baseRevision = await runGit(
			["merge-base", "HEAD", remoteDefaultBranch],
			workingDirectory,
		);
		return { baseRevision, headRevision };
	} catch {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the merge base of HEAD and the remote default branch.

Next action:
  Give a base revision with --base <revision>, or run a full review with
  --all.`);
	}
}

/** Format a review failure; a failed review reports no conclusion. */
function formatReviewFailure(error: unknown): string {
	if (error instanceof ModelSelectionError) {
		return error.diagnostic;
	}
	if (error instanceof ReviewTargetError) {
		return `Standards review could not run.

Problem:
  ${error.message}

Next action:
  Give a target path that exists in the head revision.`;
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
