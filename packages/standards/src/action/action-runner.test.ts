import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import type { ReportedFinding } from "../review/review-report.js";
import {
	createCheckRun,
	createFindingComments,
	createPullRequestComment,
	updateCheckRun,
	updatePullRequestComment,
	upsertSummaryComment,
} from "./action-runner.js";
import {
	findingFingerprint,
	REPORT_COMMENT_MARKER,
} from "./report-markdown.js";

/** One queued mock response: a JSON body with an optional error status. */
type MockResponse = unknown | { status: number; body: unknown };

/** A mocked GitHub API that records requests and returns queued responses. */
function mockGitHub(responses: MockResponse[]): {
	github: Octokit;
	requests: Request[];
} {
	const requests: Request[] = [];
	let responseIndex = 0;
	const mockFetch: typeof fetch = async (input, init) => {
		requests.push(new Request(input, init));
		const queued = responses[responseIndex] ?? {};
		responseIndex += 1;
		const withStatus =
			typeof queued === "object" && queued !== null && "status" in queued
				? (queued as { status: number; body: unknown })
				: { status: 200, body: queued };
		return new Response(JSON.stringify(withStatus.body), {
			status: withStatus.status,
			headers: { "content-type": "application/json" },
		});
	};
	return { github: new Octokit({ request: { fetch: mockFetch } }), requests };
}

describe("GitHub feedback", () => {
	it("creates and updates a PR comment and check run", async () => {
		const requests: Request[] = [];
		const responses = [
			{
				id: 101,
				html_url: "https://github.com/acme/widgets/pull/42#comment-101",
			},
			{
				id: 101,
				html_url: "https://github.com/acme/widgets/pull/42#comment-101",
			},
			{ id: 202, html_url: "https://github.com/acme/widgets/runs/202" },
			{ id: 202, html_url: "https://github.com/acme/widgets/runs/202" },
		];
		let responseIndex = 0;
		const mockFetch: typeof fetch = async (input, init) => {
			requests.push(new Request(input, init));
			const response = responses[responseIndex];
			responseIndex += 1;
			return new Response(JSON.stringify(response), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const github = new Octokit({ request: { fetch: mockFetch } });
		const pullRequest = {
			owner: "acme",
			repository: "widgets",
			pullRequestNumber: 42,
		};
		const checkTarget = {
			owner: "acme",
			repository: "widgets",
			headSha: "0123456789abcdef0123456789abcdef01234567",
		};

		const comment = await createPullRequestComment(
			github,
			pullRequest,
			"Standards started.",
		);
		await updatePullRequestComment(
			github,
			pullRequest,
			comment.id,
			"Standards completed.",
		);
		const checkRun = await createCheckRun(github, checkTarget, "Standards");
		await updateCheckRun(github, checkTarget, checkRun.id, {
			conclusion: "success",
			title: "Standards passed",
			summary: "No violations found.",
		});

		expect(requests.map((request) => request.method)).toEqual([
			"POST",
			"PATCH",
			"POST",
			"PATCH",
		]);
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/repos/acme/widgets/issues/42/comments",
			"/repos/acme/widgets/issues/comments/101",
			"/repos/acme/widgets/check-runs",
			"/repos/acme/widgets/check-runs/202",
		]);
		expect(await requests[0]?.text()).toBe(
			JSON.stringify({ body: "Standards started." }),
		);
		expect(await requests[1]?.text()).toBe(
			JSON.stringify({ body: "Standards completed." }),
		);
		expect(await requests[2]?.text()).toContain('"status":"in_progress"');
		expect(await requests[3]?.text()).toContain('"conclusion":"success"');
	});
});

describe("createFindingComments", () => {
	const target = {
		owner: "acme",
		repository: "widgets",
		pullRequestNumber: 42,
		headSha: "0123456789abcdef0123456789abcdef01234567",
	};
	const finding = (
		line: number,
		lastLine = line,
		rule = "money.no-float",
	): ReportedFinding => ({
		rule,
		level: "MUST NOT",
		path: "invoice.ts",
		lines: [line, lastLine],
		evidence: `const total = subtotal * 1.2 // ${rule}:${line}`,
		reason: "The total is a floating-point number.",
	});
	const renderBody = (comment: ReportedFinding) =>
		`<!-- standards:finding:v1:${findingFingerprint(comment)} -->\nbody`;

	it("posts one COMMENT review with one comment per finding", async () => {
		const { github, requests } = mockGitHub([[], {}]);

		const unanchored = await createFindingComments(
			github,
			target,
			[finding(1), finding(8, 12, "money.no-round")],
			renderBody,
		);

		expect(unanchored).toEqual([]);
		expect(
			requests.map((request) => [
				request.method,
				new URL(request.url).pathname,
			]),
		).toEqual([
			["GET", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/reviews"],
		]);
		const review = JSON.parse(await (requests[1]?.text() ?? ""));
		expect(review.event).toBe("COMMENT");
		expect(review.commit_id).toBe(target.headSha);
		expect(review.comments).toHaveLength(2);
		expect(review.comments[0]).toMatchObject({
			path: "invoice.ts",
			line: 1,
			side: "RIGHT",
		});
		expect(review.comments[0].start_line).toBeUndefined();
		expect(review.comments[1]).toMatchObject({ line: 12, start_line: 8 });
	});

	it("skips findings whose fingerprint marker already exists", async () => {
		const posted = finding(1);
		const { github, requests } = mockGitHub([
			[{ id: 7, body: renderBody(posted) }],
		]);

		const unanchored = await createFindingComments(
			github,
			target,
			[posted],
			renderBody,
		);

		expect(unanchored).toEqual([]);
		expect(requests.map((request) => request.method)).toEqual(["GET"]);
	});

	it("falls back to one comment per finding and returns the unanchored", async () => {
		const anchorable = finding(1);
		const outsideDiff = finding(900, 900, "money.no-round");
		const { github, requests } = mockGitHub([
			[],
			{ status: 422, body: { message: "not part of the diff" } },
			{},
			{ status: 422, body: { message: "not part of the diff" } },
		]);

		const unanchored = await createFindingComments(
			github,
			target,
			[anchorable, outsideDiff],
			renderBody,
		);

		expect(unanchored).toEqual([outsideDiff]);
		expect(
			requests.map((request) => [
				request.method,
				new URL(request.url).pathname,
			]),
		).toEqual([
			["GET", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/reviews"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
		]);
	});

	const renderSuggestionBody = (
		comment: ReportedFinding,
		includeSuggestion: boolean,
	) =>
		`<!-- standards:finding:v1:${findingFingerprint(comment)} -->\n${includeSuggestion ? "suggestion body" : "plain body"}`;

	it("retries a rejected suggestion comment once without the suggestion", async () => {
		const withSuggestion = {
			...finding(1),
			suggested_change: "const total = Money.fromMinorUnits(1200);",
		};
		const { github, requests } = mockGitHub([
			[],
			{ status: 422, body: { message: "suggestion rejected" } },
			{ status: 422, body: { message: "suggestion rejected" } },
			{},
		]);

		const unanchored = await createFindingComments(
			github,
			target,
			[withSuggestion],
			renderSuggestionBody,
		);

		expect(unanchored).toEqual([]);
		expect(
			requests.map((request) => [
				request.method,
				new URL(request.url).pathname,
			]),
		).toEqual([
			["GET", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/reviews"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
		]);
		const retry = JSON.parse(await (requests[3]?.text() ?? ""));
		expect(retry.body).toContain("plain body");
		expect(retry.body).not.toContain("suggestion body");
	});

	it("treats a suggestion comment rejected twice as unanchored", async () => {
		const withSuggestion = {
			...finding(1),
			suggested_change: "const total = Money.fromMinorUnits(1200);",
		};
		const { github, requests } = mockGitHub([
			[],
			{ status: 422, body: {} },
			{ status: 422, body: {} },
			{ status: 422, body: {} },
		]);

		const unanchored = await createFindingComments(
			github,
			target,
			[withSuggestion],
			renderSuggestionBody,
		);

		expect(unanchored).toEqual([withSuggestion]);
		expect(
			requests.map((request) => [
				request.method,
				new URL(request.url).pathname,
			]),
		).toEqual([
			["GET", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/reviews"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
		]);
	});

	it("does not retry when the posted body carried no suggestion block", async () => {
		// The renderer omits the suggestion when the comment is too large, so
		// both include-suggestion choices produce the same body.
		const withSuggestion = {
			...finding(1),
			suggested_change: "const total = Money.fromMinorUnits(1200);",
		};
		const { github, requests } = mockGitHub([
			[],
			{ status: 422, body: {} },
			{ status: 422, body: {} },
		]);

		const unanchored = await createFindingComments(
			github,
			target,
			[withSuggestion],
			renderBody,
		);

		expect(unanchored).toEqual([withSuggestion]);
		expect(
			requests.map((request) => [
				request.method,
				new URL(request.url).pathname,
			]),
		).toEqual([
			["GET", "/repos/acme/widgets/pulls/42/comments"],
			["POST", "/repos/acme/widgets/pulls/42/reviews"],
			["POST", "/repos/acme/widgets/pulls/42/comments"],
		]);
	});
});

describe("upsertSummaryComment", () => {
	const target = {
		owner: "acme",
		repository: "widgets",
		pullRequestNumber: 42,
	};

	it("updates the comment found by the marker", async () => {
		const { github, requests } = mockGitHub([
			[
				{ id: 7, body: "a human comment" },
				{ id: 8, body: `${REPORT_COMMENT_MARKER}\nold report` },
			],
			{ id: 8, html_url: "https://github.com/acme/widgets/pull/42#comment-8" },
		]);

		await upsertSummaryComment(github, target, "new report", true);

		expect(requests.map((request) => request.method)).toEqual(["GET", "PATCH"]);
		expect(new URL(requests[1]?.url ?? "").pathname).toBe(
			"/repos/acme/widgets/issues/comments/8",
		);
	});

	it("creates the comment only when the review produced content", async () => {
		const { github, requests } = mockGitHub([
			[],
			{ id: 9, html_url: "https://github.com/acme/widgets/pull/42#comment-9" },
		]);

		await upsertSummaryComment(github, target, "report", true);

		expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
	});

	it("creates nothing for a clean run without an existing comment", async () => {
		const { github, requests } = mockGitHub([[]]);

		await upsertSummaryComment(github, target, "report", false);

		expect(requests.map((request) => request.method)).toEqual(["GET"]);
	});
});
