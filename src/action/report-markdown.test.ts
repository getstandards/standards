import { describe, expect, it } from "vitest";
import { modelReferenceSchema } from "../review/model-reference.js";
import type { ReviewReport } from "../review/review-report.js";
import {
	REPORT_COMMENT_MARKER,
	renderCheckRunSummary,
	renderFailureComment,
	renderSummaryComment,
} from "./report-markdown.js";

const context = {
	repositoryUrl: "https://github.com/acme/shop",
	headSha: "3f2a91c000000000000000000000000000000000",
	mergeBaseSha: "a1b04dd000000000000000000000000000000000",
};

/** The report data of the specs/github.md comment example. */
function exampleReport(): ReviewReport {
	return {
		version: 1,
		conclusion: "non-compliant",
		models: {
			evaluation: modelReferenceSchema.parse("anthropic/claude-sonnet-5"),
			verification: modelReferenceSchema.parse("anthropic/claude-opus-5"),
		},
		counts: { resolved_rules: 24, selected_rules: 6, evaluation_tasks: 3 },
		usage: {
			evaluation: { invocations: 3, input_tokens: 41_200, output_tokens: 1810 },
			verification: { invocations: 3, input_tokens: 3900, output_tokens: 240 },
		},
		findings: [
			{
				rule: "payments.no-floating-point-money",
				level: "MUST NOT",
				path: "src/billing/invoice.ts",
				lines: [41, 44],
				evidence: "const total: number = subtotal * 1.2",
				reason: "The invoice total is computed as a floating-point number.",
				guidance: "Use the Money value object.",
				references: ["https://engineering.example.com/decisions/money-values"],
			},
			{
				rule: "security.no-secrets-in-code",
				level: "MUST NOT",
				path: "src/config/stripe.ts",
				lines: [8, 8],
				evidence: 'const stripeKey = "sk_live_x"',
				reason: "A live API key is committed in source code.",
			},
			{
				rule: "api.problem-details-errors",
				level: "SHOULD",
				path: "api/orders.yaml",
				lines: [88, 95],
				evidence: "error: { type: string }",
				reason: "The error response defines an ad-hoc shape.",
			},
		],
		suppressed: [
			{
				rule: "payments.no-floating-point-money",
				level: "MUST NOT",
				path: "src/billing/estimate.ts",
				lines: [12, 12],
				evidence: "const estimate = price * 1.2",
				reason: "The estimate is a floating-point number.",
				suppression_reason: "display-only estimate, PAY-421",
			},
		],
		invalid_suppressions: [
			{
				path: "src/billing/refund.ts",
				line: 33,
				reason: "names a rule that is not in the resolved rule set",
			},
		],
	};
}

describe("renderSummaryComment", () => {
	it("renders the full layout in order for the example report", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		const lines = comment.split("\n");
		expect(lines[0]).toBe(REPORT_COMMENT_MARKER);
		expect(lines[1]).toBe("## 🛑 Standards review — Non-compliant");
		expect(comment).toContain("> [!CAUTION]");
		expect(comment).toContain("**2 blocking findings**");
		expect(comment).toContain("1 warning and 1 suppressed finding are");
		// Sections appear in the specified order.
		const order = [
			"| # | Rule | Level | Location |",
			"### 🛑 Blocking findings",
			"### ⚠️ Warnings",
			"### 🔇 Suppressed",
			"invalid suppression marker",
			"<b>Review details</b>",
			"against merge base",
		];
		const positions = order.map((section) => comment.indexOf(section));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it("numbers blocking findings first and links the head commit blob", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		expect(comment).toContain(
			"#### 1. `payments.no-floating-point-money` — MUST NOT",
		);
		expect(comment).toContain(
			"#### 2. `security.no-secrets-in-code` — MUST NOT",
		);
		expect(comment).toContain(
			"<summary><b>3.</b> <code>api.problem-details-errors</code> — SHOULD",
		);
		expect(comment).toContain(
			`${context.repositoryUrl}/blob/${context.headSha}/src/billing/invoice.ts#L41-L44`,
		);
		expect(comment).not.toContain("/pull/");
	});

	it("renders the evidence as an added diff line and the fix block", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		expect(comment).toContain(
			"```diff\n+ const total: number = subtotal * 1.2\n```",
		);
		expect(comment).toContain(
			"> 💡 **How to fix:** Use the Money value object.",
		);
		expect(comment).toContain(
			"[engineering.example.com/decisions/money-values](https://engineering.example.com/decisions/money-values)",
		);
	});

	it("renders the review details counts and usage", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		expect(comment).toContain(
			"📊 <b>Review details</b> — 24 rules resolved · 6 selected · 3 evaluation tasks · 47,150 tokens",
		);
		expect(comment).toContain(
			"| Evaluation | `anthropic/claude-sonnet-5` | 3 | 41,200 | 1,810 |",
		);
		expect(comment).toContain("confirmed by an independent verification pass");
	});

	it("omits the overview table with one finding and empty sections", () => {
		const report = exampleReport();
		report.findings = report.findings.slice(0, 1);
		report.suppressed = [];
		report.invalid_suppressions = [];
		const comment = renderSummaryComment(report, context);
		expect(comment).not.toContain("| # | Rule | Level | Location |");
		expect(comment).not.toContain("### ⚠️ Warnings");
		expect(comment).not.toContain("### 🔇 Suppressed");
	});

	it("renders a compliant heading for warnings without blocking findings", () => {
		const report = exampleReport();
		report.conclusion = "compliant";
		report.findings = report.findings.filter(
			(finding) => finding.level === "SHOULD",
		);
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain("## ✅ Standards review — Compliant");
		expect(comment).toContain("**No blocking findings.**");
		expect(comment).toContain("Warnings do not block the merge by themselves.");
	});

	it("truncates a manipulated evidence quote", () => {
		const report = exampleReport();
		report.findings = report.findings.slice(0, 1).map((finding) => ({
			...finding,
			evidence: Array.from({ length: 40 }, (_, index) => `line ${index}`).join(
				"\n",
			),
		}));
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain("+ line 9");
		expect(comment).not.toContain("+ line 10");
		expect(comment).toContain("+ …");
	});

	it("keeps evidence backticks inside the code fence", () => {
		const report = exampleReport();
		report.findings = report.findings
			.slice(0, 1)
			.map((finding) => ({ ...finding, evidence: "``` injected\ntext" }));
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain("````diff\n+ ``` injected\n+ text\n````");
	});
});

describe("renderCheckRunSummary", () => {
	it("renders the same body without the comment marker", () => {
		const summary = renderCheckRunSummary(exampleReport(), context);
		expect(summary.startsWith("## 🛑 Standards review — Non-compliant")).toBe(
			true,
		);
		expect(summary).not.toContain(REPORT_COMMENT_MARKER);
	});
});

describe("renderFailureComment", () => {
	it("carries the marker, the failed heading, and the diagnostic", () => {
		const comment = renderFailureComment(
			"Standards review failed.\n\nProblem:\n  x",
			{
				repositoryUrl: context.repositoryUrl,
				headSha: context.headSha,
			},
		);
		expect(comment.split("\n")[0]).toBe(REPORT_COMMENT_MARKER);
		expect(comment).toContain("## 🛑 Standards review — Failed");
		expect(comment).toContain("Standards review failed.");
		expect(comment).toContain(
			`${context.repositoryUrl}/commit/${context.headSha}`,
		);
	});
});
