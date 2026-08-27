import { openRunGitSourceStore } from "../../cache/git-source-cache.js";
import { createImportProgressReporter } from "../../cache/import-progress.js";
import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import type { ChangeScope } from "../../review/change-scope.js";
import { ModelSelectionError } from "../../review/model-selection.js";
import { ReviewProviderError } from "../../review/review-agent.js";
import type { ReviewReport } from "../../review/review-report.js";
import { ReviewTargetError } from "../../review/review-target.js";
import { runReview } from "../../review/run-review.js";
import type { Resolution } from "../../rules/rules-loader.js";
import { loadRules } from "../../rules/rules-loader.js";
import { errorMessage } from "../../utils/errors.js";
import { runGit } from "../../utils/git.js";
import type { ReviewCliArgs } from "../cli-args.js";
import type { CommandContext } from "../cli-context.js";
import {
	renderReviewReportTerminal,
	renderReviewReportText,
} from "./review-report-text.js";
import { filterRuleSet, ReviewRuleFilterError } from "./review-rule-filter.js";
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
	output.log(
		options.format === "json"
			? JSON.stringify(report, undefined, "\t")
			: context.interactive
				? renderReviewReportTerminal(report)
				: renderReviewReportText(report),
	);
	return report.conclusion === "compliant" ? 0 : 1;
}

/**
 * Resolve the change scope of one review (specs/cli.md review).
 *
 * Without a scope option the scope is the working tree against the merge base
 * of HEAD and the remote default branch, so uncommitted work is reviewed.
 * `--base` replaces that base, `--all` replaces it with the empty tree,
 * `--range` selects two commits, and `--staged` selects the index.
 */
async function resolveChangeScope(
	workingDirectory: string,
	options: ReviewCliArgs,
): Promise<ChangeScope> {
	// Every scope needs a repository with at least one commit.
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

	if (options.range !== undefined) {
		return resolveRangeScope(workingDirectory, options.range);
	}

	if (options.staged) {
		return { kind: "staged", baseRevision: headRevision };
	}

	if (options.all) {
		// The hash of the empty tree, computed so it matches the repository's
		// object format (SHA-1 or SHA-256).
		const emptyTree = await runGit(
			["hash-object", "-t", "tree", "/dev/null"],
			workingDirectory,
		);
		return { kind: "working-tree", baseRevision: emptyTree };
	}

	if (options.base !== undefined) {
		try {
			const baseRevision = await runGit(
				["rev-parse", "--verify", `${options.base}^{commit}`],
				workingDirectory,
			);
			return { kind: "working-tree", baseRevision };
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
		return { kind: "working-tree", baseRevision };
	} catch {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the merge base of HEAD and the remote default branch.

Next action:
  Give a base revision with --base <revision>, a commit range with
  --range <base>..<head>, or run a full review with --all.`);
	}
}

/**
 * Resolve a `--range` value to a commits scope (specs/cli.md review --range).
 *
 * `A..B` compares the two commits. `A...B` compares the merge base of A and B
 * with B, which is the change B adds to A.
 */
async function resolveRangeScope(
	workingDirectory: string,
	range: string,
): Promise<ChangeScope> {
	const symmetricIndex = range.indexOf("...");
	const separatorIndex =
		symmetricIndex === -1 ? range.indexOf("..") : symmetricIndex;
	const separatorLength = symmetricIndex === -1 ? 2 : 3;
	const left = separatorIndex === -1 ? "" : range.slice(0, separatorIndex);
	const right =
		separatorIndex === -1 ? "" : range.slice(separatorIndex + separatorLength);
	if (separatorIndex === -1 || left === "" || right === "") {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Option '--range' expects '<base>..<head>' or '<base>...<head>', not '${range}'.

Next action:
  Give --range a Git commit range, such as 'main..HEAD' or 'HEAD~3..HEAD'.`);
	}

	const headRevision = await resolveRangeRevision(
		workingDirectory,
		range,
		right,
	);
	if (symmetricIndex === -1) {
		const baseRevision = await resolveRangeRevision(
			workingDirectory,
			range,
			left,
		);
		return { kind: "commits", baseRevision, headRevision };
	}

	// A symmetric range resolves both sides first, so an unresolvable revision
	// reports itself instead of a merge-base failure.
	await resolveRangeRevision(workingDirectory, range, left);
	try {
		const baseRevision = await runGit(
			["merge-base", left, right],
			workingDirectory,
		);
		return { kind: "commits", baseRevision, headRevision };
	} catch (error) {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the merge base of '${left}' and '${right}': ${errorMessage(error)}

Next action:
  Give --range two commits that share history, or use '${left}..${right}'.`);
	}
}

/** Resolve one side of a `--range` value to a commit. */
async function resolveRangeRevision(
	workingDirectory: string,
	range: string,
	revision: string,
): Promise<string> {
	try {
		return await runGit(
			["rev-parse", "--verify", `${revision}^{commit}`],
			workingDirectory,
		);
	} catch (error) {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the revision '${revision}' of '--range ${range}': ${errorMessage(error)}

Next action:
  Give --range two revisions that Git can resolve in this repository.`);
	}
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
