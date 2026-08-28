import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "@getstandards/core/internal";
import { afterEach, describe, expect, it } from "vitest";
import { loadActionContext, resolveReviewRevisions } from "./action-context.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-action-"));
	temporaryDirectories.push(directory);
	return directory;
}

async function writeEventPayload(payload: unknown): Promise<string> {
	const directory = await temporaryDirectory();
	const eventPath = path.join(directory, "event.json");
	await writeFile(eventPath, JSON.stringify(payload));
	return eventPath;
}

function pullRequestPayload(headRepo: string | null = "acme/shop") {
	return {
		pull_request: {
			number: 42,
			head: {
				sha: "1111111111111111111111111111111111111111",
				repo: headRepo === null ? null : { full_name: headRepo },
			},
			base: {
				sha: "2222222222222222222222222222222222222222",
				repo: { full_name: "acme/shop" },
			},
		},
	};
}

async function runnerEnvironment(payload: unknown): Promise<NodeJS.ProcessEnv> {
	return {
		GITHUB_EVENT_NAME: "pull_request",
		GITHUB_EVENT_PATH: await writeEventPayload(payload),
		GITHUB_REPOSITORY: "acme/shop",
		GITHUB_WORKSPACE: "/workspace",
	};
}

describe("loadActionContext", () => {
	it("loads the pull request context from the runner environment", async () => {
		const context = await loadActionContext(
			await runnerEnvironment(pullRequestPayload()),
		);
		expect(context).toEqual({
			owner: "acme",
			repository: "shop",
			pullRequestNumber: 42,
			headSha: "1111111111111111111111111111111111111111",
			baseSha: "2222222222222222222222222222222222222222",
			fromFork: false,
			workspace: "/workspace",
			serverUrl: "https://github.com",
		});
	});

	it("detects a pull request from a fork", async () => {
		const context = await loadActionContext(
			await runnerEnvironment(pullRequestPayload("forker/shop")),
		);
		expect(context.fromFork).toBe(true);
	});

	it("treats a deleted head repository as a fork", async () => {
		const context = await loadActionContext(
			await runnerEnvironment(pullRequestPayload(null)),
		);
		expect(context.fromFork).toBe(true);
	});

	it("rejects an event other than pull_request", async () => {
		const environment = await runnerEnvironment(pullRequestPayload());
		environment.GITHUB_EVENT_NAME = "push";
		await expect(loadActionContext(environment)).rejects.toThrow(
			"'pull_request'",
		);
	});

	it("rejects the pull_request_target event by name", async () => {
		const environment = await runnerEnvironment(pullRequestPayload());
		environment.GITHUB_EVENT_NAME = "pull_request_target";
		await expect(loadActionContext(environment)).rejects.toThrow(
			"pull_request_target",
		);
	});

	it("rejects a payload that is not a pull request payload", async () => {
		await expect(
			loadActionContext(await runnerEnvironment({ action: "opened" })),
		).rejects.toThrow("not a pull request event payload");
	});
});

describe("resolveReviewRevisions", () => {
	async function initRepository(): Promise<string> {
		const directory = await temporaryDirectory();
		await runGit(["init", "-q", "-b", "main"], directory);
		await runGit(["config", "user.email", "test@example.com"], directory);
		await runGit(["config", "user.name", "Test"], directory);
		return directory;
	}

	async function commitAll(
		directory: string,
		message: string,
	): Promise<string> {
		await runGit(["add", "-A"], directory);
		await runGit(["commit", "-q", "-m", message], directory);
		return runGit(["rev-parse", "HEAD"], directory);
	}

	it("resolves the merge base of the head commit and the base branch", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "notes.md"), "base\n");
		const mergeBase = await commitAll(directory, "base");
		await runGit(["checkout", "-q", "-b", "feature"], directory);
		await writeFile(path.join(directory, "feature.md"), "feature\n");
		const headSha = await commitAll(directory, "feature");
		await runGit(["checkout", "-q", "main"], directory);
		await writeFile(path.join(directory, "notes.md"), "moved on\n");
		const baseSha = await commitAll(directory, "base moved on");

		const revisions = await resolveReviewRevisions({
			owner: "acme",
			repository: "shop",
			pullRequestNumber: 42,
			headSha,
			baseSha,
			fromFork: false,
			workspace: directory,
			serverUrl: "https://github.com",
		});
		expect(revisions).toEqual({
			baseRevision: mergeBase,
			headRevision: headSha,
		});
	});

	it("fails with a fetch-depth diagnostic when the head commit is missing", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "notes.md"), "base\n");
		const baseSha = await commitAll(directory, "base");

		await expect(
			resolveReviewRevisions({
				owner: "acme",
				repository: "shop",
				pullRequestNumber: 42,
				headSha: "1111111111111111111111111111111111111111",
				baseSha,
				fromFork: false,
				workspace: directory,
				serverUrl: "https://github.com",
			}),
		).rejects.toThrow("fetch-depth: 0");
	});
});
