import { Octokit } from "@octokit/rest";
import type { ReportedFinding } from "../review/review-report.js";
import type { ActionInputs } from "./action-inputs.js";
import { parseActionInputs } from "./action-inputs.js";
import { REPORT_COMMENT_MARKER } from "./report-markdown.js";

/** A repository targeted by the action. */
export interface RepositoryTarget {
	owner: string;
	repository: string;
}

/** The repository and pull request targeted by a comment. */
export interface PullRequestTarget extends RepositoryTarget {
	pullRequestNumber: number;
}

/** The repository and commit targeted by a check run. */
export interface CheckRunTarget extends RepositoryTarget {
	headSha: string;
}

/** A GitHub resource created by the action. */
export interface CreatedGitHubResource {
	id: number;
	url: string;
}

/** A supported final conclusion for a Standards check run. */
export type CheckRunConclusion =
	| "success"
	| "failure"
	| "neutral"
	| "cancelled";

/** One check run annotation on a confirmed finding (specs/github.md). */
export interface CheckRunAnnotation {
	path: string;
	start_line: number;
	end_line: number;
	annotation_level: "failure" | "warning" | "notice";
	title: string;
	message: string;
}

/** Content used to update and complete a Standards check run. */
export interface UpdateCheckRunOptions {
	conclusion: CheckRunConclusion;
	title: string;
	summary: string;
	annotations?: readonly CheckRunAnnotation[];
}

/** The most annotations one check run update request accepts. */
const ANNOTATION_BATCH_SIZE = 50;

/**
 * Map confirmed findings to check run annotations (specs/github.md).
 *
 * A `MUST` or `MUST NOT` finding annotates as a failure; every other level
 * annotates as a warning. The text carries the rule id, the reason, and the
 * rule's guidance when present.
 */
export function buildAnnotations(
	findings: readonly ReportedFinding[],
): CheckRunAnnotation[] {
	return findings.map((finding) => ({
		path: finding.path,
		start_line: finding.lines[0],
		end_line: finding.lines[1],
		annotation_level:
			finding.level === "MUST" || finding.level === "MUST NOT"
				? "failure"
				: "warning",
		title: `${finding.rule} — ${finding.level}`,
		message:
			finding.guidance === undefined
				? finding.reason
				: `${finding.reason}\n\nHow to fix: ${finding.guidance}`,
	}));
}

/** Runtime dependencies created from action inputs. */
export interface ActionRuntime {
	github: Octokit;
	inputs: ActionInputs;
}

/** Create a comment on a pull request timeline. */
export async function createPullRequestComment(
	github: Octokit,
	target: PullRequestTarget,
	body: string,
): Promise<CreatedGitHubResource> {
	const { data } = await github.issues.createComment({
		owner: target.owner,
		repo: target.repository,
		issue_number: target.pullRequestNumber,
		body,
	});

	return { id: data.id, url: data.html_url };
}

/** Update a comment previously created on a pull request timeline. */
export async function updatePullRequestComment(
	github: Octokit,
	target: RepositoryTarget,
	commentId: number,
	body: string,
): Promise<CreatedGitHubResource> {
	const { data } = await github.issues.updateComment({
		owner: target.owner,
		repo: target.repository,
		comment_id: commentId,
		body,
	});

	return { id: data.id, url: data.html_url };
}

/** Create an in-progress check run and return its ID for later updates. */
export async function createCheckRun(
	github: Octokit,
	target: CheckRunTarget,
	name: string,
): Promise<CreatedGitHubResource> {
	const { data } = await github.checks.create({
		owner: target.owner,
		repo: target.repository,
		name,
		head_sha: target.headSha,
		status: "in_progress",
		started_at: new Date().toISOString(),
	});

	return { id: data.id, url: data.html_url ?? "" };
}

/**
 * Update and complete a check run previously created by the action.
 *
 * The API accepts at most fifty annotations per request, so the annotations
 * go out in batches and every finding is annotated (specs/github.md).
 */
export async function updateCheckRun(
	github: Octokit,
	target: RepositoryTarget,
	checkRunId: number,
	options: UpdateCheckRunOptions,
): Promise<void> {
	const annotations = options.annotations ?? [];
	const batches: CheckRunAnnotation[][] = [];
	for (
		let start = 0;
		start < annotations.length;
		start += ANNOTATION_BATCH_SIZE
	) {
		batches.push(annotations.slice(start, start + ANNOTATION_BATCH_SIZE));
	}

	await github.checks.update({
		owner: target.owner,
		repo: target.repository,
		check_run_id: checkRunId,
		status: "completed",
		conclusion: options.conclusion,
		completed_at: new Date().toISOString(),
		output: {
			title: options.title,
			summary: options.summary,
			annotations: batches[0] ?? [],
		},
	});
	for (const batch of batches.slice(1)) {
		await github.checks.update({
			owner: target.owner,
			repo: target.repository,
			check_run_id: checkRunId,
			output: {
				title: options.title,
				summary: options.summary,
				annotations: batch,
			},
		});
	}
}

/** Find the summary comment by its hidden marker (specs/github.md). */
export async function findSummaryCommentId(
	github: Octokit,
	target: PullRequestTarget,
): Promise<number | undefined> {
	const comments = await github.paginate(github.issues.listComments, {
		owner: target.owner,
		repo: target.repository,
		issue_number: target.pullRequestNumber,
		per_page: 100,
	});
	return comments.find((comment) =>
		comment.body?.startsWith(REPORT_COMMENT_MARKER),
	)?.id;
}

/**
 * Create or update the summary comment (specs/github.md summary comment).
 *
 * An existing marked comment is updated in place. A missing comment is
 * created only when `createWhenMissing` is true: a clean run adds no noise,
 * so a compliant review without findings never creates one.
 */
export async function upsertSummaryComment(
	github: Octokit,
	target: PullRequestTarget,
	body: string,
	createWhenMissing: boolean,
): Promise<void> {
	const commentId = await findSummaryCommentId(github, target);
	if (commentId !== undefined) {
		await updatePullRequestComment(github, target, commentId, body);
		return;
	}
	if (createWhenMissing) {
		await createPullRequestComment(github, target, body);
	}
}

/** Create the runtime dependencies used by the GitHub Action. */
export function createActionRuntime(
	environment: NodeJS.ProcessEnv = process.env,
): ActionRuntime {
	const inputs = parseActionInputs(environment);
	return {
		github: new Octokit({ auth: inputs.githubToken }),
		inputs,
	};
}
