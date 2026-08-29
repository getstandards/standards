import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReportedFinding } from "@getstandards/core";
import { runGitOutput } from "@getstandards/core/internal";
import { Octokit } from "@octokit/rest";
import type { ActionInputs } from "./action-inputs.js";
import { parseActionInputs } from "./action-inputs.js";
import {
	FINDING_MARKER_PATTERN,
	findingFingerprint,
	findingSourceAnchor,
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

/**
 * One existing finding comment on the pull request, as the action reads it
 * for the identity check (specs/github.md finding comments).
 */
export interface ExistingFindingComment {
	/** The fingerprint on the marker of the comment's first line. */
	fingerprint: string;
	/** The rule id the comment names in its footer, when it carries one. */
	rule?: string;
	/** The file path the comment is anchored to. */
	path: string;
	/**
	 * The line range GitHub currently maps the comment to in the head
	 * revision, when GitHub still maps one. An outdated comment has none.
	 */
	lines?: [number, number];
}

/**
 * List the finding comments already on the pull request (specs/github.md).
 *
 * A comment is a finding comment when its first line is the finding marker.
 * The rule id and the GitHub-mapped line range are read from the comment
 * itself: the identity check needs them while GitHub can still map the
 * comment to the current diff.
 */
export async function listFindingComments(
	github: Octokit,
	target: PullRequestTarget,
): Promise<ExistingFindingComment[]> {
	const comments = await github.paginate(github.pulls.listReviewComments, {
		owner: target.owner,
		repo: target.repository,
		pull_number: target.pullRequestNumber,
		per_page: 100,
	});
	const findingComments: ExistingFindingComment[] = [];
	for (const comment of comments) {
		const body = comment.body ?? "";
		const fingerprint = body
			.split("\n", 1)[0]
			?.match(FINDING_MARKER_PATTERN)?.[1];
		if (fingerprint === undefined) {
			continue;
		}
		findingComments.push({
			fingerprint,
			rule: ruleNamedByComment(body),
			path: comment.path,
			lines: mappedLineRange(comment.line, comment.start_line),
		});
	}
	return findingComments;
}

/**
 * The rule id a finding comment names in its footer, when the footer is
 * present (specs/github.md finding comments).
 */
function ruleNamedByComment(body: string): string | undefined {
	return body.match(/<sub>[^<]*`([^`]+)`[^<]*Standards review<\/sub>/)?.[1];
}

/**
 * The line range GitHub currently maps the comment to, or undefined when
 * the comment is outdated and GitHub provides none. The action posts its
 * comments on the right side of the diff, so a mapped range names head
 * revision lines, the same lines a finding's `lines` refer to.
 */
function mappedLineRange(
	line: number | null | undefined,
	startLine: number | null | undefined,
): [number, number] | undefined {
	if (line === null || line === undefined) {
		return undefined;
	}
	return [startLine ?? line, line];
}

/** Return true when two inclusive line ranges share at least one line. */
function rangesOverlap(a: [number, number], b: [number, number]): boolean {
	return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * Return true when an existing finding comment carries the same finding.
 *
 * A comment GitHub can still map to the current diff matches by rule, path,
 * and an overlapping line range; the range check is primary because an
 * agent can select different but overlapping ranges for the same violation.
 * An equal fingerprint never matches such a comment with a mapped,
 * non-overlapping range: identical source text can identify separate
 * violations in one file. Only a comment without a mapped range — an
 * outdated comment — matches by its fingerprint (specs/github.md finding
 * comments).
 */
function sameFinding(
	comment: ExistingFindingComment,
	finding: ReportedFinding,
	fingerprint: string,
): boolean {
	if (comment.lines !== undefined) {
		return (
			comment.rule === finding.rule &&
			comment.path === finding.path &&
			rangesOverlap(comment.lines, finding.lines)
		);
	}
	return comment.fingerprint === fingerprint;
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
 * A finding that matches an existing finding comment is skipped: by rule,
 * path, and an overlapping GitHub-mapped line range when the comment is
 * still mapped to the current diff, and by fingerprint when the comment is
 * outdated and GitHub no longer maps a range. A re-run for the same or a
 * new head commit therefore never creates a second comment for the same
 * finding. `readAnchor` returns the finding's source anchor, which the
 * fingerprint is computed from. The comments post as one pull request
 * review with the `COMMENT` event and no body, so no verdict is expressed
 * and reviewers get one notification. GitHub rejects a comment whose
 * location is not part of the diff, and one rejected location fails the
 * whole review, so a failed review falls back to one comment per finding.
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
	readAnchor: (finding: ReportedFinding) => string,
	renderBody: (finding: ReportedFinding, includeSuggestion: boolean) => string,
): Promise<ReportedFinding[]> {
	if (findings.length === 0) {
		return [];
	}
	const existing = await listFindingComments(github, target);
	const newFindings = findings.filter((finding) => {
		const fingerprint = findingFingerprint(
			finding.rule,
			finding.path,
			readAnchor(finding),
		);
		return !existing.some((comment) =>
			sameFinding(comment, finding, fingerprint),
		);
	});
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

/**
 * Read the source anchor of each finding from the checkout
 * (specs/github.md finding comments).
 *
 * The anchor is the exact text from the first through the last finding
 * line, `\n`-separated and without a final line break. It comes from the
 * head revision — the working tree the action reviews — and from the base
 * revision for a deleted file, which the head checkout no longer contains.
 * The anchor never carries model output, so the fingerprint stays stable
 * across runs.
 *
 * A finding whose revision content cannot be read gets an empty anchor: its
 * fingerprint then matches no existing comment, and the comment is posted
 * — or rejected as unanchored and rendered in the summary comment instead
 * of failing the run.
 */
export async function readFindingAnchors(
	workspace: string,
	baseRevision: string,
	findings: readonly ReportedFinding[],
): Promise<Map<ReportedFinding, string>> {
	const anchors = new Map<ReportedFinding, string>();
	for (const finding of findings) {
		anchors.set(
			finding,
			await sourceAnchorAt(workspace, baseRevision, finding),
		);
	}
	return anchors;
}

/** The source anchor of one finding, from the checkout or the base revision. */
async function sourceAnchorAt(
	workspace: string,
	baseRevision: string,
	finding: ReportedFinding,
): Promise<string> {
	let content: string;
	try {
		content = await readFile(path.join(workspace, finding.path), "utf8");
	} catch {
		try {
			content = await runGitOutput(
				["show", `${baseRevision}:${finding.path}`],
				workspace,
			);
		} catch {
			return "";
		}
	}
	return findingSourceAnchor(content, finding.lines);
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
