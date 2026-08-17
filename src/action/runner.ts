import { Octokit } from "@octokit/rest";
import type { ActionInputs } from "./inputs.js";
import { parseActionInputs } from "./inputs.js";

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

/** Initialize one Standards GitHub Action run. */
export async function runAction(
	environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	createActionRuntime(environment);
}
