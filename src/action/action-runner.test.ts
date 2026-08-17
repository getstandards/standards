import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import {
	createCheckRun,
	createPullRequestComment,
	updateCheckRun,
	updatePullRequestComment,
} from "./action-runner.js";

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
