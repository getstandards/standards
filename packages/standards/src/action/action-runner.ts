import { Octokit } from "@octokit/rest";
import type { ReportedFinding } from "../review/review-report.js";
import type { ActionInputs } from "./action-inputs.js";
import { parseActionInputs } from "./action-inputs.js";
import {
	FINDING_MARKER_PATTERN,
	findingFingerprint,
	REPORT_COMMENT_MARKER,
} from "./report-markdown.js";

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

/** Content used to update and complete a Standards check run. */
export interface UpdateCheckRunOptions {
	conclusion: CheckRunConclusion;
	title: string;
	summary: string;
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

/** Update and complete a check run previously created by the action. */
export async function updateCheckRun(
	github: Octokit,
	target: RepositoryTarget,
	checkRunId: number,
	options: UpdateCheckRunOptions,
): Promise<void> {
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
		},
	});
}

/** The repository, pull request, and head commit finding comments target. */
export interface FindingCommentTarget extends PullRequestTarget {
	headSha: string;
}

/** List the fingerprints of the finding comments already on a pull request. */
export async function listFindingFingerprints(
	github: Octokit,
	target: PullRequestTarget,
): Promise<Set<string>> {
	const comments = await github.paginate(github.pulls.listReviewComments, {
		owner: target.owner,
		repo: target.repository,
		pull_number: target.pullRequestNumber,
		per_page: 100,
	});
	const fingerprints = new Set<string>();
	for (const comment of comments) {
		const fingerprint = comment.body.match(FINDING_MARKER_PATTERN)?.[1];
		if (fingerprint !== undefined) {
			fingerprints.add(fingerprint);
		}
	}
	return fingerprints;
}

/** One review comment of the finding review, anchored to the head commit. */
function reviewComment(finding: ReportedFinding, body: string) {
	const comment = {
		path: finding.path,
		line: finding.lines[1],
		side: "RIGHT" as const,
		body,
	};
	return finding.lines[0] === finding.lines[1]
		? comment
		: {
				...comment,
				start_line: finding.lines[0],
				start_side: "RIGHT" as const,
			};
}

/**
 * Create one finding comment per new confirmed finding (specs/github.md).
 *
 * Findings whose fingerprint marker already exists on the pull request are
 * skipped, so a re-run never duplicates a comment. The comments post as one
 * pull request review with the `COMMENT` event and no body, so no verdict is
 * expressed and reviewers get one notification. GitHub rejects a comment
 * whose location is not part of the diff, and one rejected location fails
 * the whole review, so a failed review falls back to one comment per
 * finding.
 *
 * A rejected comment that carries a suggestion block is retried once without
 * it: GitHub's diff validation is what confirms that a suggested change is
 * anchored to the head diff and lies within one diff hunk
 * (specs/github.md finding comments). A plain comment that is also rejected
 * is unanchored, so the summary comment renders it expanded instead.
 *
 * The returned findings could not be anchored; the summary comment renders
 * them expanded instead.
 */
export async function createFindingComments(
	github: Octokit,
	target: FindingCommentTarget,
	findings: readonly ReportedFinding[],
	renderBody: (finding: ReportedFinding, includeSuggestion: boolean) => string,
): Promise<ReportedFinding[]> {
	if (findings.length === 0) {
		return [];
	}
	const existing = await listFindingFingerprints(github, target);
	const newFindings = findings.filter(
		(finding) => !existing.has(findingFingerprint(finding)),
	);
	if (newFindings.length === 0) {
		return [];
	}
	const comments = newFindings.map((finding) =>
		reviewComment(finding, renderBody(finding, true)),
	);
	const pullRequest = {
		owner: target.owner,
		repo: target.repository,
		pull_number: target.pullRequestNumber,
		commit_id: target.headSha,
	};
	try {
		await github.pulls.createReview({
			...pullRequest,
			event: "COMMENT",
			body: "",
			comments,
		});
		return [];
	} catch {
		// Fall through to one comment per finding.
	}
	const unanchored: ReportedFinding[] = [];
	for (const [index, finding] of newFindings.entries()) {
		const comment = comments[index];
		if (comment === undefined) {
			continue;
		}
		try {
			await github.pulls.createReviewComment({ ...pullRequest, ...comment });
			continue;
		} catch {
			// Fall through to the retry decision below.
		}
		// Only a comment whose posted body carried a suggestion block earns a
		// retry without it (specs/github.md finding comments). The renderer may
		// have omitted the suggestion already, so compare bodies instead of
		// checking the finding.
		const plainBody = renderBody(finding, false);
		if (plainBody === comment.body) {
			unanchored.push(finding);
			continue;
		}
		try {
			await github.pulls.createReviewComment({
				...pullRequest,
				...comment,
				body: plainBody,
			});
		} catch {
			unanchored.push(finding);
		}
	}
	return unanchored;
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
