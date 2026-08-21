import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import type { ReportedFinding } from "../review/review-report.js";
import {
	buildAnnotations,
	createCheckRun,
	createPullRequestComment,
	updateCheckRun,
	updatePullRequestComment,
	upsertSummaryComment,
} from "./action-runner.js";
import { REPORT_COMMENT_MARKER } from "./report-markdown.js";

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

describe("annotations", () => {
	const finding = (
		line: number,
		level: "MUST NOT" | "SHOULD",
	): ReportedFinding => ({
		rule: "money.no-float",
		level,
		path: "invoice.ts",
		lines: [line, line],
		evidence: "const total = subtotal * 1.2",
		reason: "The total is a floating-point number.",
		guidance: "Use an integer of cents.",
	});

	it("maps levels to annotation levels and carries the rule text", () => {
		const annotations = buildAnnotations([
			finding(1, "MUST NOT"),
			finding(2, "SHOULD"),
		]);
		expect(annotations[0]).toEqual({
			path: "invoice.ts",
			start_line: 1,
			end_line: 1,
			annotation_level: "failure",
			title: "money.no-float — MUST NOT",
			message:
				"The total is a floating-point number.\n\nHow to fix: Use an integer of cents.",
		});
		expect(annotations[1]?.annotation_level).toBe("warning");
	});

	it("batches more than fifty annotations across update requests", async () => {
		const { github, requests } = mockGitHub([{}, {}, {}]);
		const annotations = buildAnnotations(
			Array.from({ length: 120 }, (_, index) => finding(index + 1, "MUST NOT")),
		);

		await updateCheckRun(
			github,
			{ owner: "acme", repository: "widgets" },
			202,
			{
				conclusion: "failure",
				title: "Non-compliant",
				summary: "Report",
				annotations,
			},
		);

		expect(requests).toHaveLength(3);
		const bodies = await Promise.all(
			requests.map(async (request) => JSON.parse(await request.text())),
		);
		expect(bodies[0].status).toBe("completed");
		expect(bodies[0].output.annotations).toHaveLength(50);
		expect(bodies[1].status).toBeUndefined();
		expect(bodies[1].output.annotations).toHaveLength(50);
		expect(bodies[2].output.annotations).toHaveLength(20);
		expect(bodies[2].output.annotations[19].start_line).toBe(120);
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
