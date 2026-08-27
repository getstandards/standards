import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it } from "vitest";
import { createAutomationModels } from "../credentials/models-runtime.js";
import { runGit } from "../utils/git.js";
import { runAction } from "./action-run.js";
import { REPORT_COMMENT_MARKER } from "./report-markdown.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

/** A repository whose feature branch adds one MUST violation. */
async function createReviewRepository(): Promise<{
	workspace: string;
	baseSha: string;
	headSha: string;
}> {
	const workspace = await mkdtemp(
		path.join(os.tmpdir(), "standards-action-run-"),
	);
	temporaryDirectories.push(workspace);
	await runGit(["init", "-q", "-b", "main"], workspace);
	await runGit(["config", "user.email", "test@example.com"], workspace);
	await runGit(["config", "user.name", "Test"], workspace);
	await writeFile(
		path.join(workspace, ".standards.yml"),
		`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions:
        level: MUST
        applies_to:
          include:
            - "**/*.ts"
`,
	);
	// The document at decisions/money/no-float.md derives the id money.no-float.
	await mkdir(path.join(workspace, "knowledge", "decisions", "money"), {
		recursive: true,
	});
	await writeFile(
		path.join(workspace, "knowledge", "decisions", "money", "no-float.md"),
		`---
title: Money must not be a floating-point number.
description: Floating-point money loses cents.
status: stable
---

Use an integer of cents.
`,
	);
	await runGit(["add", "-A"], workspace);
	await runGit(["commit", "-q", "-m", "base"], workspace);
	const baseSha = await runGit(["rev-parse", "HEAD"], workspace);
	await runGit(["checkout", "-q", "-b", "feature"], workspace);
	await writeFile(
		path.join(workspace, "invoice.ts"),
		"const total = subtotal * 1.2;\n",
	);
	await runGit(["add", "-A"], workspace);
	await runGit(["commit", "-q", "-m", "feature"], workspace);
	const headSha = await runGit(["rev-parse", "HEAD"], workspace);
	return { workspace, baseSha, headSha };
}

/** Write a pull_request event payload and return the runner environment. */
async function runnerEnvironment(options: {
	workspace: string;
	baseSha: string;
	headSha: string;
	headRepository?: string;
	inputs?: Record<string, string>;
}): Promise<NodeJS.ProcessEnv> {
	const eventPath = path.join(options.workspace, "event.json");
	await writeFile(
		eventPath,
		JSON.stringify({
			pull_request: {
				number: 42,
				head: {
					sha: options.headSha,
					repo: { full_name: options.headRepository ?? "acme/shop" },
				},
				base: { sha: options.baseSha, repo: { full_name: "acme/shop" } },
			},
		}),
	);
	return {
		GITHUB_EVENT_NAME: "pull_request",
		GITHUB_EVENT_PATH: eventPath,
		GITHUB_REPOSITORY: "acme/shop",
		GITHUB_WORKSPACE: options.workspace,
		"INPUT_GITHUB-TOKEN": "github-token",
		...options.inputs,
	};
}

/** A mocked GitHub API that records requests and returns queued bodies. */
function mockGitHub(bodies: unknown[]): {
	github: Octokit;
	requests: Request[];
} {
	const requests: Request[] = [];
	let responseIndex = 0;
	const mockFetch: typeof fetch = async (input, init) => {
		requests.push(new Request(input, init));
		const body = bodies[responseIndex] ?? {};
		responseIndex += 1;
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	return { github: new Octokit({ request: { fetch: mockFetch } }), requests };
}

/** An automation models factory whose Anthropic provider is the faux one. */
function fauxCreateModels() {
	const faux = fauxProvider({
		provider: "anthropic",
		models: [{ id: "claude-sonnet-5" }],
	});
	const respond: FauxResponseFactory = (context) => {
		if ((context.systemPrompt ?? "").includes("report_rule_verdicts")) {
			return fauxAssistantMessage([
				fauxToolCall("report_rule_verdicts", {
					verdicts: [
						{
							rule: "money.no-float",
							path: "invoice.ts",
							verdict: "violated",
							findings: [
								{
									first_line: 1,
									last_line: 1,
									evidence: "const total = subtotal * 1.2",
									reason: "The total is a floating-point number.",
								},
							],
						},
					],
				}),
			]);
		}
		return fauxAssistantMessage([
			fauxToolCall("report_verdict", { confirmed: true }),
		]);
	};
	faux.setResponses([respond, respond]);
	const createModels: typeof createAutomationModels = (options) => {
		const models = createAutomationModels(options);
		models.setProvider(faux.provider);
		return models;
	};
	return createModels;
}

/** Parse the JSON body of one recorded request. */
async function requestBody(requests: Request[], index: number) {
	const request = requests[index];
	if (request === undefined) {
		throw new Error(`No request was recorded at index ${index}.`);
	}
	return JSON.parse(await request.text());
}

describe("runAction", () => {
	it("reviews a pull request and reports a non-compliant conclusion", async () => {
		const repository = await createReviewRepository();
		const environment = await runnerEnvironment({
			...repository,
			inputs: { "INPUT_ANTHROPIC-API-KEY": "test-key" },
		});
		environment.GITHUB_OUTPUT = path.join(repository.workspace, "output.txt");
		environment.RUNNER_TEMP = repository.workspace;
		const { github, requests } = mockGitHub([
			{ id: 202, html_url: "https://github.com/acme/shop/runs/202" },
			{},
			[],
			{},
			[],
			{ id: 9, html_url: "https://github.com/acme/shop/pull/42#comment-9" },
		]);

		const exitStatus = await runAction(environment, {
			github,
			createModels: fauxCreateModels(),
		});

		// A completed review exits 0 whatever the conclusion: the check run
		// carries the verdict (specs/github.md run behavior).
		expect(exitStatus).toBe(0);
		expect(
			requests.map((request) => [
				request.method,
				new URL(request.url).pathname,
			]),
		).toEqual([
			["POST", "/repos/acme/shop/check-runs"],
			["PATCH", "/repos/acme/shop/check-runs/202"],
			["GET", "/repos/acme/shop/pulls/42/comments"],
			["POST", "/repos/acme/shop/pulls/42/reviews"],
			["GET", "/repos/acme/shop/issues/42/comments"],
			["POST", "/repos/acme/shop/issues/42/comments"],
		]);
		const completion = await requestBody(requests, 1);
		expect(completion.conclusion).toBe("failure");
		expect(completion.output.title).toBe("Non-compliant");
		expect(completion.output.summary).toContain("money.no-float");
		const review = await requestBody(requests, 3);
		expect(review.event).toBe("COMMENT");
		expect(review.commit_id).toBe(repository.headSha);
		expect(review.comments).toHaveLength(1);
		expect(review.comments[0]).toMatchObject({
			path: "invoice.ts",
			line: 1,
			side: "RIGHT",
		});
		expect(review.comments[0].body).toMatch(
			/^<!-- standards:finding:v1:[0-9a-f]{16} -->\n/,
		);
		expect(review.comments[0].body).toContain(
			"🛑 **The total is a floating-point number.**",
		);
		expect(review.comments[0].body).toContain(
			"<sub>MUST · `money.no-float` · Standards review</sub>",
		);
		const comment = await requestBody(requests, 5);
		expect(comment.body.startsWith(REPORT_COMMENT_MARKER)).toBe(true);
		expect(comment.body).toContain(`blob/${repository.headSha}/invoice.ts#L1`);

		const reportFile = path.join(repository.workspace, "standards-report.json");
		const outputs = await readFile(environment.GITHUB_OUTPUT ?? "", "utf8");
		expect(outputs).toBe(
			[
				"conclusion=non-compliant",
				"blocking-count=1",
				"warning-count=0",
				"total-cost=0.0000",
				`report-file=${reportFile}`,
				"",
			].join("\n"),
		);
		const report = JSON.parse(await readFile(reportFile, "utf8"));
		expect(report.conclusion).toBe("non-compliant");
		expect(report.findings).toHaveLength(1);
	});

	it("skips a fork pull request without credentials as neutral", async () => {
		const repository = await createReviewRepository();
		const environment = await runnerEnvironment({
			...repository,
			headRepository: "forker/shop",
		});
		const { github, requests } = mockGitHub([
			{ id: 202, html_url: "https://github.com/acme/shop/runs/202" },
			{},
		]);

		const exitStatus = await runAction(environment, { github });

		expect(exitStatus).toBe(0);
		expect(requests).toHaveLength(2);
		const completion = await requestBody(requests, 1);
		expect(completion.conclusion).toBe("neutral");
		expect(completion.output.summary).toContain("skipped");
	});

	it("fails a non-fork run without credentials as a setup error", async () => {
		const repository = await createReviewRepository();
		const environment = await runnerEnvironment(repository);
		const { github, requests } = mockGitHub([
			{ id: 202, html_url: "https://github.com/acme/shop/runs/202" },
			{},
		]);

		const exitStatus = await runAction(environment, { github });

		expect(exitStatus).toBe(2);
		expect(requests).toHaveLength(2);
		const completion = await requestBody(requests, 1);
		expect(completion.conclusion).toBe("failure");
		expect(completion.output.summary).toContain("anthropic-api-key");
	});

	it("completes the check run as failure when the review cannot run", async () => {
		const repository = await createReviewRepository();
		const environment = await runnerEnvironment({
			...repository,
			// A head commit that is not in the checkout: the review cannot run.
			headSha: "1111111111111111111111111111111111111111",
			inputs: { "INPUT_ANTHROPIC-API-KEY": "test-key" },
		});
		environment.GITHUB_OUTPUT = path.join(repository.workspace, "output.txt");
		const { github, requests } = mockGitHub([
			{ id: 202, html_url: "https://github.com/acme/shop/runs/202" },
			{},
			[],
			{ id: 9, html_url: "https://github.com/acme/shop/pull/42#comment-9" },
		]);

		const exitStatus = await runAction(environment, {
			github,
			createModels: fauxCreateModels(),
		});

		expect(exitStatus).toBe(2);
		const completion = await requestBody(requests, 1);
		expect(completion.conclusion).toBe("failure");
		expect(completion.output.summary).toContain("fetch-depth: 0");
		const comment = await requestBody(requests, 3);
		expect(comment.body.startsWith(REPORT_COMMENT_MARKER)).toBe(true);
		expect(comment.body).toContain("reports no conclusion");
		expect(existsSync(environment.GITHUB_OUTPUT ?? "")).toBe(false);
	});
});
