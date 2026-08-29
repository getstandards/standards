import { appendFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	loadRules,
	type ReportedFinding,
	type Resolution,
	type ReviewReport,
	runReview,
} from "@getstandards/core";
import { createTemporaryGitSourceStore } from "@getstandards/core/internal";
import type { Octokit } from "@octokit/rest";
import { formatReviewFailure } from "../cli/commands/review.js";
import { renderReviewReportText } from "../cli/commands/review-report-text.js";
import { formatValidationError } from "../cli/commands/validate-diagnostic.js";
import { createAutomationModels } from "../credentials/models-runtime.js";
import type { ActionContext } from "./action-context.js";
import {
	ActionContextError,
	loadActionContext,
	resolveReviewRevisions,
} from "./action-context.js";
import type { ReviewEnvironment } from "./action-inputs.js";
import { buildReviewEnvironment } from "./action-inputs.js";
import {
	createActionRuntime,
	createCheckRun,
	createFindingComments,
	readFindingAnchors,
	updateCheckRun,
	upsertSummaryComment,
} from "./action-runner.js";
import {
	renderCheckRunSummary,
	renderFailureComment,
	renderFindingComment,
	renderSummaryComment,
} from "./report-markdown.js";

/** The name of the check run the action creates (specs/github.md). */
const CHECK_RUN_NAME = "Standards";

/** The check run summary of a fork run skipped without credentials. */
const FORK_SKIP_SUMMARY = `Standards review was skipped.

GitHub withholds repository secrets from \`pull_request\` runs for pull
requests from forks, so no provider API key is available and the review
cannot run. A fork contributor cannot fix a missing secret, so this check
does not fail. Version 1 does not review fork pull requests with
repository secrets.`;

/** The diagnostic of a non-fork run without a usable provider credential. */
const MISSING_CREDENTIAL_DIAGNOSTIC = `Standards review could not run.

Problem:
  No provider credential was given. The review needs at least one provider
  API key.

Next action:
  Set the 'anthropic-api-key', 'openai-api-key', or 'google-api-key' input
  from a repository or organization secret, or name extra credential
  variables with the 'provider-env' input and set them on the step with
  'env:'.`;

/** Replaceable dependencies of one action run, for tests. */
export interface RunActionOverrides {
	github?: Octokit;
	createModels?: typeof createAutomationModels;
}

/**
 * Run one Standards GitHub Action review (specs/github.md run behavior).
 *
 * It creates the check run, runs the review pipeline, writes the report to
 * the step log, completes the check run with the report, creates one
 * finding comment per new confirmed finding, creates or updates the summary
 * comment, and returns the exit status of the outcome: 0 for a completed
 * review whatever the conclusion, 2 when the run could not complete. The
 * check run carries the verdict; the job stays green so a rule violation
 * does not look like a tool failure.
 */
export async function runAction(
	environment: NodeJS.ProcessEnv = process.env,
	overrides: RunActionOverrides = {},
): Promise<number> {
	// Context and input problems are setup errors. They can happen before the
	// check run exists, so they print a diagnostic and fail the job directly.
	const context = await loadActionContext(environment);
	const runtime = createActionRuntime(environment);
	const github = overrides.github ?? runtime.github;
	const review = buildReviewEnvironment(runtime.inputs, environment);

	const repositoryTarget = {
		owner: context.owner,
		repository: context.repository,
	};
	const checkRun = await createCheckRun(
		github,
		{ ...repositoryTarget, headSha: context.headSha },
		CHECK_RUN_NAME,
	);
	const completeCheckRun = (options: {
		conclusion: "success" | "failure" | "neutral" | "cancelled";
		title: string;
		summary: string;
	}) => updateCheckRun(github, repositoryTarget, checkRun.id, options);

	if (!review.hasCredential) {
		if (context.fromFork) {
			await completeCheckRun({
				conclusion: "neutral",
				title: "Review skipped",
				summary: FORK_SKIP_SUMMARY,
			});
			console.log(FORK_SKIP_SUMMARY);
			return 0;
		}
		await completeCheckRun({
			conclusion: "failure",
			title: "Review could not run",
			summary: MISSING_CREDENTIAL_DIAGNOSTIC,
		});
		console.error(MISSING_CREDENTIAL_DIAGNOSTIC);
		return 2;
	}

	// A cancelled workflow run, for example from the concurrency group when a
	// new commit arrives, sends a signal. The review aborts, and the check run
	// completes as cancelled while the API is still reachable.
	const abortController = new AbortController();
	const handleSignal = () => abortController.abort();
	process.once("SIGINT", handleSignal);
	process.once("SIGTERM", handleSignal);

	try {
		const report = await runReviewPipeline(
			context,
			review,
			abortController.signal,
			overrides.createModels ?? createAutomationModels,
		);
		// The step log carries the report too: a user who opens the job log
		// must not find a bare failure (specs/github.md step log).
		console.log(renderReviewReportText(report.report));
		console.log(`\n${conclusionLogLine(report.report)}`);
		const conclusion =
			report.report.conclusion === "compliant" ? "success" : "failure";
		await completeCheckRun({
			conclusion,
			title:
				report.report.conclusion === "compliant"
					? "Compliant"
					: "Non-compliant",
			summary: renderCheckRunSummary(report.report, report.renderContext),
		});
		// The fingerprint is computed from the file text in the checkout,
		// never from model output (specs/github.md finding comments). The
		// anchor of a deleted file comes from the base revision, which the
		// checkout still holds.
		const anchors = await readFindingAnchors(
			context.workspace,
			report.renderContext.mergeBaseSha,
			report.report.findings,
		);
		const readAnchor = (finding: ReportedFinding) => anchors.get(finding) ?? "";
		const unanchored = await createFindingComments(
			github,
			{
				...repositoryTarget,
				pullRequestNumber: context.pullRequestNumber,
				headSha: context.headSha,
			},
			report.report.findings,
			readAnchor,
			(finding, includeSuggestion) =>
				renderFindingComment(finding, readAnchor(finding), includeSuggestion),
		);
		const hasEntries =
			report.report.findings.length > 0 ||
			report.report.suppressed.length > 0 ||
			report.report.invalid_suppressions.length > 0;
		await upsertSummaryComment(
			github,
			{ ...repositoryTarget, pullRequestNumber: context.pullRequestNumber },
			renderSummaryComment(report.report, report.renderContext, unanchored),
			hasEntries,
		);
		await writeActionOutputs(report.report, environment);
		// A completed review exits 0 whatever the conclusion: the check run is
		// the verdict surface, and merging is gated by requiring it.
		return 0;
	} catch (error) {
		if (abortController.signal.aborted) {
			await completeQuietly(() =>
				completeCheckRun({
					conclusion: "cancelled",
					title: "Review cancelled",
					summary:
						"The workflow run was cancelled before the review completed.",
				}),
			);
			return 1;
		}
		const diagnostic = formatActionFailure(error);
		console.error(diagnostic);
		await completeQuietly(() =>
			completeCheckRun({
				conclusion: "failure",
				title: "Review failed",
				summary: diagnostic,
			}),
		);
		await completeQuietly(() =>
			upsertSummaryComment(
				github,
				{ ...repositoryTarget, pullRequestNumber: context.pullRequestNumber },
				renderFailureComment(diagnostic, {
					repositoryUrl: repositoryUrl(context),
					headSha: context.headSha,
				}),
				true,
			),
		);
		return 2;
	} finally {
		process.removeListener("SIGINT", handleSignal);
		process.removeListener("SIGTERM", handleSignal);
	}
}

/**
 * The final step log line: the conclusion, the finding counts, and where
 * the full result appears (specs/github.md step log).
 */
function conclusionLogLine(report: ReviewReport): string {
	const blocking = report.findings.filter(
		(finding) => finding.level === "MUST",
	).length;
	const warnings = report.findings.length - blocking;
	const label =
		report.conclusion === "compliant" ? "Compliant" : "Non-compliant";
	const counts = [
		`${blocking} blocking ${blocking === 1 ? "finding" : "findings"}`,
		`${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
	].join(", ");
	return `${label}: ${counts}. See the Standards check run and the pull request comments.`;
}

/**
 * Write the action outputs for downstream workflow steps (specs/github.md).
 *
 * A run that did not complete a review writes none, so downstream steps read
 * every output as an empty string.
 */
async function writeActionOutputs(
	report: ReviewReport,
	environment: NodeJS.ProcessEnv,
): Promise<void> {
	const outputPath = environment.GITHUB_OUTPUT;
	if (outputPath === undefined || outputPath === "") {
		return;
	}
	const reportFile = path.join(
		environment.RUNNER_TEMP ?? os.tmpdir(),
		"standards-report.json",
	);
	await writeFile(reportFile, `${JSON.stringify(report, undefined, "\t")}\n`);
	const blockingCount = report.findings.filter(
		(finding) => finding.level === "MUST",
	).length;
	const lines = [
		`conclusion=${report.conclusion}`,
		`blocking-count=${blockingCount}`,
		`warning-count=${report.findings.length - blockingCount}`,
		`total-cost=${report.usage.total_cost.toFixed(4)}`,
		`report-file=${reportFile}`,
	];
	await appendFile(outputPath, `${lines.join("\n")}\n`);
}

/** The repository web URL the rendered report links into. */
function repositoryUrl(context: ActionContext): string {
	return `${context.serverUrl}/${context.owner}/${context.repository}`;
}

/** A run failure and the report links it renders with. */
interface PipelineResult {
	report: ReviewReport;
	renderContext: {
		repositoryUrl: string;
		headSha: string;
		mergeBaseSha: string;
	};
}

/** A rule loading failure whose diagnostic is already formatted. */
class RuleLoadError extends Error {
	public constructor(diagnostic: string) {
		super(diagnostic);
		this.name = "RuleLoadError";
	}
}

/** Resolve the revisions and the rules, then run the review pipeline. */
async function runReviewPipeline(
	context: ActionContext,
	review: ReviewEnvironment,
	signal: AbortSignal,
	createModels: typeof createAutomationModels,
): Promise<PipelineResult> {
	const revisions = await resolveReviewRevisions(context);

	// Each run starts with an empty source cache on an ephemeral runner, and
	// the action never restores one from a CI cache service (specs/cache.md).
	const gitSourceStore = createTemporaryGitSourceStore();
	let loaded: Resolution;
	try {
		loaded = await loadRules(context.workspace, { gitSourceStore });
	} catch (error) {
		throw new RuleLoadError(
			await formatValidationError(error, context.workspace),
		);
	} finally {
		await gitSourceStore.dispose();
	}

	const models = createModels({
		environment: review.environment,
		allowedEnvironmentVariables: review.allowedEnvironmentVariables,
	});
	// The model inputs already arrived as STANDARDS_MODEL and the per-step
	// variables, so selection precedence stays as specs/review.md defines it.
	const report = await runReview({
		// The action reviews the commits of a pull request, never a runner's
		// working tree (specs/github.md).
		scope: {
			kind: "commits",
			baseRevision: revisions.baseRevision,
			headRevision: revisions.headRevision,
		},
		workingDirectory: context.workspace,
		resolution: loaded,
		models,
		environment: review.environment,
		reportProgress: (line) => console.log(line),
		signal,
	});
	return {
		report,
		renderContext: {
			repositoryUrl: repositoryUrl(context),
			headSha: context.headSha,
			mergeBaseSha: revisions.baseRevision,
		},
	};
}

/** Format a run failure as the diagnostic the check run summary carries. */
function formatActionFailure(error: unknown): string {
	if (error instanceof ActionContextError || error instanceof RuleLoadError) {
		return error.message;
	}
	return formatReviewFailure(error);
}

/**
 * Run a completion step and swallow its API failure. A run that already
 * failed keeps its first diagnostic; a reporting failure never masks it.
 */
async function completeQuietly(step: () => Promise<void>): Promise<void> {
	try {
		await step();
	} catch (error) {
		console.error(
			`::warning::Could not report the result to GitHub: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
