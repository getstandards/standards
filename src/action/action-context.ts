import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import { errorMessage } from "../utils/errors.js";
import { runGit } from "../utils/git.js";

/** The action could not run: its diagnostic is ready to print (specs/github.md). */
export class ActionContextError extends Error {
	public constructor(diagnostic: string) {
		super(diagnostic);
		this.name = "ActionContextError";
	}
}

/** The fields the action reads from a `pull_request` event payload. */
const pullRequestEventSchema = z.object({
	pull_request: z.object({
		number: z.number().int().positive(),
		head: z.object({
			sha: z.string().min(1),
			repo: z.object({ full_name: z.string() }).nullish(),
		}),
		base: z.object({
			sha: z.string().min(1),
			repo: z.object({ full_name: z.string() }),
		}),
	}),
});

/** The GitHub context of one action run (specs/github.md run behavior). */
export interface ActionContext {
	owner: string;
	repository: string;
	pullRequestNumber: number;
	headSha: string;
	baseSha: string;
	/** True when the pull request head lives in a fork of the repository. */
	fromFork: boolean;
	/** The checkout directory the review reads. */
	workspace: string;
	/** The GitHub web URL prefix, such as `https://github.com`. */
	serverUrl: string;
}

/** Read one required runner environment variable or throw a diagnostic. */
function requireEnvironment(
	environment: NodeJS.ProcessEnv,
	name: string,
): string {
	const value = environment[name];
	if (value === undefined || value === "") {
		throw new ActionContextError(`Standards action could not run.

Problem:
  The ${name} environment variable is not set.

Next action:
  Run the action on a GitHub Actions runner, which sets ${name}.`);
	}
	return value;
}

/**
 * Load the GitHub context of one run (specs/github.md workflow integration).
 *
 * The action runs on `pull_request` events only; any other event fails with
 * a diagnostic that names the supported event.
 */
export async function loadActionContext(
	environment: NodeJS.ProcessEnv = process.env,
): Promise<ActionContext> {
	const eventName = requireEnvironment(environment, "GITHUB_EVENT_NAME");
	if (eventName === "pull_request_target") {
		throw new ActionContextError(`Standards action could not run.

Problem:
  The action ran on a 'pull_request_target' event, which hands repository
  secrets to a run that reads untrusted fork content.

Next action:
  Trigger the workflow with 'on: pull_request' (specs/github.md).`);
	}
	if (eventName !== "pull_request") {
		throw new ActionContextError(`Standards action could not run.

Problem:
  The action ran on a '${eventName}' event. The only supported event is
  'pull_request'.

Next action:
  Trigger the workflow with 'on: pull_request'.`);
	}

	const repositoryPath = requireEnvironment(environment, "GITHUB_REPOSITORY");
	const [owner, repository] = repositoryPath.split("/");
	if (owner === undefined || repository === undefined || repository === "") {
		throw new ActionContextError(`Standards action could not run.

Problem:
  GITHUB_REPOSITORY is not an 'owner/repository' value: '${repositoryPath}'.

Next action:
  Run the action on a GitHub Actions runner, which sets GITHUB_REPOSITORY.`);
	}

	const eventPath = requireEnvironment(environment, "GITHUB_EVENT_PATH");
	let payload: unknown;
	try {
		payload = JSON.parse(await readFile(eventPath, "utf8"));
	} catch (error) {
		throw new ActionContextError(`Standards action could not run.

Problem:
  Cannot read the event payload at '${eventPath}': ${errorMessage(error)}

Next action:
  Run the action on a GitHub Actions runner, which writes the event payload.`);
	}
	const parsed = pullRequestEventSchema.safeParse(payload);
	if (!parsed.success) {
		throw new ActionContextError(`Standards action could not run.

Problem:
  The event payload is not a pull request event payload.

Next action:
  Trigger the workflow with 'on: pull_request'.`);
	}
	const pullRequest = parsed.data.pull_request;

	return {
		owner,
		repository,
		pullRequestNumber: pullRequest.number,
		headSha: pullRequest.head.sha,
		baseSha: pullRequest.base.sha,
		// A missing head repository means the fork was deleted; treat it as a
		// fork so a secretless run skips instead of failing.
		fromFork:
			pullRequest.head.repo?.full_name !== pullRequest.base.repo.full_name,
		workspace: requireEnvironment(environment, "GITHUB_WORKSPACE"),
		serverUrl: environment.GITHUB_SERVER_URL ?? "https://github.com",
	};
}

/** The resolved base and head commits of one action review. */
export interface ReviewRevisions {
	baseRevision: string;
	headRevision: string;
}

/**
 * Resolve the merge base the review compares against (specs/github.md).
 *
 * The review compares the pull request's head commit against the merge base
 * of the head commit and the base branch. Both commits must be in the
 * checkout; the workflow example uses `fetch-depth: 0` for this reason.
 */
export async function resolveReviewRevisions(
	context: ActionContext,
): Promise<ReviewRevisions> {
	try {
		await runGit(
			["rev-parse", "--verify", `${context.headSha}^{commit}`],
			context.workspace,
		);
	} catch (error) {
		throw new ActionContextError(`Standards review could not run.

Problem:
  The head commit ${context.headSha} is not in the checkout:
  ${errorMessage(error)}

Next action:
  Check out the pull request with 'actions/checkout' and 'fetch-depth: 0'
  before this action.`);
	}
	try {
		const mergeBase = await runGit(
			["merge-base", context.baseSha, context.headSha],
			context.workspace,
		);
		return { baseRevision: mergeBase, headRevision: context.headSha };
	} catch (error) {
		throw new ActionContextError(`Standards review could not run.

Problem:
  Cannot resolve the merge base of ${context.headSha} and the base branch
  commit ${context.baseSha}: ${errorMessage(error)}

Next action:
  Check out the pull request with 'actions/checkout' and 'fetch-depth: 0'
  so the checkout contains the merge base.`);
	}
}
