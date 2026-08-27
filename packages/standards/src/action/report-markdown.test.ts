import { describe, expect, it } from "vitest";
import { modelReferenceSchema } from "../review/model-reference.js";
import type { ReviewReport } from "../review/review-report.js";
import {
	FINDING_MARKER_PATTERN,
	findingFingerprint,
	findingSourceAnchor,
	REPORT_COMMENT_MARKER,
	renderCheckRunSummary,
	renderFailureComment,
	renderFindingComment,
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
		version: 3,
		conclusion: "non-compliant",
		models: {
			evaluation: modelReferenceSchema.parse("anthropic/claude-sonnet-5"),
			verification: modelReferenceSchema.parse("anthropic/claude-opus-5"),
		},
		counts: { resolved_rules: 24, selected_rules: 6, evaluation_tasks: 3 },
		usage: {
			evaluation: {
				invocations: 3,
				input_tokens: 41_200,
				cache_read_tokens: 38_400,
				cache_write_tokens: 2800,
				output_tokens: 1810,
				cost: 0.0421,
			},
			verification: {
				invocations: 3,
				input_tokens: 3900,
				cache_read_tokens: 0,
				cache_write_tokens: 0,
				output_tokens: 240,
				cost: 0.0102,
			},
			total_cost: 0.0523,
			cost_basis: "charged",
		},
		sources: [],
		warnings: [],
		findings: [
			{
				rule: "payments.no-floating-point-money",
				level: "MUST",
				title: "Represent money as integer minor units.",
				path: "src/billing/invoice.ts",
				lines: [41, 44],
				evidence: "const total: number = subtotal * 1.2",
				reason: "The invoice total is computed as a floating-point number.",
				suggested_change:
					"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
				suggestion: "Use the Money value object.",
			},
			{
				rule: "security.no-secrets-in-code",
				level: "MUST",
				title: "Never commit secrets in source code.",
				path: "src/config/stripe.ts",
				lines: [8, 8],
				evidence: 'const stripeKey = "sk_live_x"',
				reason: "A live API key is committed in source code.",
			},
			{
				rule: "api.problem-details-errors",
				level: "SHOULD",
				title: "Error responses use the problem details shape.",
				path: "api/orders.yaml",
				lines: [88, 95],
				evidence: "error: { type: string }",
				reason: "The error response defines an ad-hoc shape.",
			},
		],
		suppressed: [
			{
				rule: "payments.no-floating-point-money",
				level: "MUST",
				title: "Represent money as integer minor units.",
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
	it("renders the index layout in order for the example report", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		const lines = comment.split("\n");
		expect(lines[0]).toBe(REPORT_COMMENT_MARKER);
		expect(lines[1]).toBe("## 🛑 Standards review — Non-compliant");
		expect(comment).toContain("> [!CAUTION]");
		expect(comment).toContain("**2 blocking findings**");
		expect(comment).toContain("1 warning and 1 suppressed finding are");
		expect(comment).toContain(
			"Each confirmed finding has a review comment on its lines.",
		);
		// Sections appear in the specified order.
		const order = [
			"| # | Rule | Level | Location |",
			"### 🔇 Suppressed",
			"invalid suppression marker",
			"<b>Review details</b>",
			"against merge base",
		];
		const positions = order.map((section) => comment.indexOf(section));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it("indexes the findings without repeating their detail", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		// Blocking findings come first in the overview numbering.
		expect(comment).toContain(
			"| 1 | `payments.no-floating-point-money` | 🛑 MUST |",
		);
		expect(comment).toContain(
			"| 3 | `api.problem-details-errors` | ⚠️ SHOULD |",
		);
		expect(comment).toContain(
			`${context.repositoryUrl}/blob/${context.headSha}/src/billing/invoice.ts#L41-L44`,
		);
		expect(comment).not.toContain("/pull/");
		// The detail lives in the finding comments.
		expect(comment).not.toContain("```diff");
		expect(comment).not.toContain("How to fix");
	});

	it("expands a finding without a finding comment", () => {
		const report = exampleReport();
		const unanchored = report.findings[2];
		if (unanchored === undefined) {
			throw new Error("The example report has three findings.");
		}
		const comment = renderSummaryComment(report, context, [unanchored]);
		expect(comment).toContain("### Findings without a review comment");
		expect(comment).toContain("could not be anchored");
		// The expanded finding keeps its overview number.
		expect(comment).toContain("#### 3. `api.problem-details-errors` — SHOULD");
		// The rule statement follows the heading.
		expect(comment).toContain(
			"**Error responses use the problem details shape.**",
		);
		expect(comment).toContain("```diff\n+ error: { type: string }\n```");
		// A partially anchored review does not claim every finding has one.
		expect(comment).not.toContain(
			"Each confirmed finding has a review comment on its lines.",
		);
	});

	it("renders the review details counts and usage", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		expect(comment).toContain(
			"📊 <b>Review details</b> — 24 rules resolved · 6 selected · 3 evaluation tasks · 47,150 tokens",
		);
		expect(comment).toContain("| 🛑 MUST | 2 |");
		expect(comment).toContain("| ⚠️ SHOULD | 1 |");
		expect(comment).toContain(
			"| Evaluation | `anthropic/claude-sonnet-5` | 3 | 41,200 | 1,810 | $0.0421 |",
		);
		expect(comment).toContain("| Total | | | | | $0.0523 |");
		// A charged review carries no cost note.
		expect(comment).not.toContain("list price estimate");
		expect(comment).toContain("confirmed by an independent verification pass");
	});

	it("notes a cost that is a list price estimate", () => {
		const report = exampleReport();
		report.usage.cost_basis = "list_price_estimate";
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain(
			"The cost is a list price estimate, not a charge.",
		);
	});

	it("lists the resolved commit of each Git knowledge source", () => {
		const report = exampleReport();
		report.sources = [
			{
				repository: "https://github.com/acme/standards",
				branch: "main",
				commit: "b7e21aa000000000000000000000000000000000",
			},
		];
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain("Knowledge sources:");
		expect(comment).toContain(
			"- `https://github.com/acme/standards` at `main`: `b7e21aa000000000000000000000000000000000`",
		);
	});

	it("omits the knowledge sources list without a Git source", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		expect(comment).not.toContain("Knowledge sources:");
	});

	it("renders the skipped documents callout after the verdict", () => {
		const report = exampleReport();
		report.warnings = [
			{
				document: "knowledge/decisions/money.md",
				problem: "The document has no frontmatter block.",
			},
		];
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain(
			"> [!WARNING]\n> **1 knowledge document was skipped** and not enforced. Fix them in their knowledge repository:\n> - `knowledge/decisions/money.md` — The document has no frontmatter block.",
		);
		// The callout sits between the verdict and the overview table.
		const calloutPosition = comment.indexOf("knowledge document was skipped");
		expect(calloutPosition).toBeGreaterThan(comment.indexOf("> [!CAUTION]"));
		expect(calloutPosition).toBeLessThan(
			comment.indexOf("| # | Rule | Level | Location |"),
		);
	});

	it("omits the skipped documents callout without warnings", () => {
		const comment = renderSummaryComment(exampleReport(), context);
		expect(comment).not.toContain("knowledge document");
	});

	it("keeps the overview table with one finding, omits empty sections", () => {
		const report = exampleReport();
		report.findings = report.findings.slice(0, 1);
		report.suppressed = [];
		report.invalid_suppressions = [];
		const comment = renderSummaryComment(report, context);
		expect(comment).toContain("| # | Rule | Level | Location |");
		expect(comment).not.toContain("### Findings without a review comment");
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
	});
});

describe("renderFindingComment", () => {
	const finding = () => {
		const found = exampleReport().findings[0];
		if (found === undefined) {
			throw new Error("The example report has three findings.");
		}
		return found;
	};
	// The source anchor is the file text the finding's lines cover; the
	// fixture's evidence stands in for it.
	const sourceAnchor = "const total: number = subtotal * 1.2";

	it("starts with the fingerprint marker and renders the finding", () => {
		const comment = renderFindingComment(finding(), sourceAnchor);
		const lines = comment.split("\n");
		expect(lines[0]).toBe(
			`<!-- standards:finding:v1:${findingFingerprint(finding().rule, finding().path, sourceAnchor)} -->`,
		);
		expect(lines[0]).toMatch(FINDING_MARKER_PATTERN);
		expect(lines[1]).toBe(
			"🛑 **The invoice total is computed as a floating-point number.**",
		);
		expect(comment).toContain("💡 Use the Money value object.");
		expect(comment).toContain(
			"<sub>MUST · `payments.no-floating-point-money` · Standards review</sub>",
		);
		// The annotated lines sit directly above the comment.
		expect(comment).not.toContain("Evidence");
		expect(comment).not.toContain("```diff");
	});

	it("renders the suggestion block after the reason when applicable", () => {
		const comment = renderFindingComment(finding(), sourceAnchor);
		expect(comment).toContain(
			"🛑 **The invoice total is computed as a floating-point number.**\n\n" +
				"```suggestion\n" +
				"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);\n" +
				"```\n\n💡 Use the Money value object.",
		);
	});

	it("retries without the suggestion block when includeSuggestion is false", () => {
		const comment = renderFindingComment(finding(), sourceAnchor, false);
		expect(comment).toContain(
			"🛑 **The invoice total is computed as a floating-point number.**",
		);
		expect(comment).not.toContain("```suggestion");
		expect(comment).not.toContain("Money.fromMinorUnits");
	});

	it("uses a longer fence when the replacement can close the default one", () => {
		const injected = {
			...finding(),
			suggested_change: "const a = 1;\n```\nconst b = 2;",
		};
		const comment = renderFindingComment(injected, sourceAnchor);
		expect(comment).toContain("````suggestion\n");
	});

	it("omits the suggestion block when the complete comment is too large", () => {
		const huge = { ...finding(), suggested_change: "x".repeat(70_000) };
		const comment = renderFindingComment(huge, sourceAnchor);
		expect(comment).toContain(
			"🛑 **The invoice total is computed as a floating-point number.**",
		);
		expect(comment).not.toContain("```suggestion");
	});

	it("marks a warning-level finding and omits absent advice", () => {
		const warning = exampleReport().findings[2];
		if (warning === undefined) {
			throw new Error("The example report has three findings.");
		}
		const comment = renderFindingComment(warning, sourceAnchor);
		expect(comment).toContain(
			"🟡 **The error response defines an ad-hoc shape.**",
		);
		expect(comment).not.toContain("💡");
		expect(comment).toContain(
			"<sub>SHOULD · `api.problem-details-errors` · Standards review</sub>",
		);
	});

	it("keeps the fingerprint stable when only the lines move", () => {
		const moved = { ...finding(), lines: [90, 93] as [number, number] };
		expect(findingFingerprint(moved.rule, moved.path, sourceAnchor)).toBe(
			findingFingerprint(finding().rule, finding().path, sourceAnchor),
		);
	});

	it("keeps the fingerprint stable when model output changes", () => {
		// The evidence, the reason, and the suggested change are agent
		// output and can differ between runs (specs/github.md); they must
		// not affect finding identity.
		const changed = {
			...finding(),
			evidence: "const total = subtotal * 1.3",
			reason: "A different reason.",
			suggested_change: "const total = Money.fromMinorUnits(1300);",
		};
		expect(findingFingerprint(changed.rule, changed.path, sourceAnchor)).toBe(
			findingFingerprint(finding().rule, finding().path, sourceAnchor),
		);
	});

	it("changes the fingerprint when the source anchor changes", () => {
		const differentAnchor = "const total = subtotal * 1.3";
		expect(
			findingFingerprint(finding().rule, finding().path, differentAnchor),
		).not.toBe(
			findingFingerprint(finding().rule, finding().path, sourceAnchor),
		);
	});
});

describe("findingSourceAnchor", () => {
	it("extracts the finding lines with \\n separators", () => {
		expect(findingSourceAnchor("a\nb\nc\nd\ne", [2, 4])).toBe("b\nc\nd");
	});

	it("omits a final line break from the anchor", () => {
		expect(findingSourceAnchor("a\nb\n", [1, 2])).toBe("a\nb");
	});

	it("keeps one-line ranges to one line", () => {
		expect(findingSourceAnchor("a\nb\n", [2, 2])).toBe("b");
	});
});

describe("expanded finding evidence", () => {
	/** A report whose only finding renders expanded in the summary comment. */
	const reportWithEvidence = (evidence: string) => {
		const report = exampleReport();
		report.findings = report.findings
			.slice(0, 1)
			.map((finding) => ({ ...finding, evidence }));
		return report;
	};

	it("truncates a manipulated evidence quote", () => {
		const report = reportWithEvidence(
			Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"),
		);
		const comment = renderSummaryComment(report, context, report.findings);
		expect(comment).toContain("+ line 9");
		expect(comment).not.toContain("+ line 10");
		expect(comment).toContain("+ …");
	});

	it("keeps evidence backticks inside the code fence", () => {
		const report = reportWithEvidence("``` injected\ntext");
		const comment = renderSummaryComment(report, context, report.findings);
		expect(comment).toContain("````diff\n+ ``` injected\n+ text\n````");
	});
});

describe("renderCheckRunSummary", () => {
	it("keeps every finding expanded on the standalone surface", () => {
		const summary = renderCheckRunSummary(exampleReport(), context);
		expect(summary.startsWith("## 🛑 Standards review — Non-compliant")).toBe(
			true,
		);
		expect(summary).not.toContain(REPORT_COMMENT_MARKER);
		const order = [
			"| # | Rule | Level | Location |",
			"### 🛑 Blocking findings",
			"#### 1. `payments.no-floating-point-money` — MUST",
			"### ⚠️ Warnings",
			"### 🔇 Suppressed",
		];
		const positions = order.map((section) => summary.indexOf(section));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		// Each expanded finding states its rule right under the heading.
		expect(summary).toContain(
			"#### 1. `payments.no-floating-point-money` — MUST\n\n**Represent money as integer minor units.**",
		);
	});

	it("renders the remediation suggestion as a fix block", () => {
		const summary = renderCheckRunSummary(exampleReport(), context);
		expect(summary).toContain(
			"> 💡 **How to fix:** Use the Money value object.",
		);
	});

	it("renders the skipped documents callout with plural wording", () => {
		const report = exampleReport();
		report.warnings = [
			{ document: "a.md", problem: "p1" },
			{ document: "b.md", problem: "p2" },
		];
		const summary = renderCheckRunSummary(report, context);
		expect(summary).toContain(
			"**2 knowledge documents were skipped** and not enforced.",
		);
		expect(summary).toContain("> - `a.md` — p1");
		expect(summary).toContain("> - `b.md` — p2");
	});

	it("shows a suggested change as a plain replacement block", () => {
		const summary = renderCheckRunSummary(exampleReport(), context);
		expect(summary).toContain("Suggested change:");
		expect(summary).toContain(
			"```\nconst total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);\n```",
		);
		// The summary block is not a GitHub suggestion: it is not attached to
		// an applicable diff range (specs/github.md comment layout).
		expect(summary).not.toContain("```suggestion");
	});

	it("shows the replacement block for a collapsed warning finding", () => {
		const report = exampleReport();
		const anchorFinding = report.findings[0];
		if (anchorFinding === undefined) {
			throw new Error("The example report has findings.");
		}
		report.conclusion = "compliant";
		report.findings = [{ ...anchorFinding, level: "SHOULD" }];
		report.suppressed = [];
		report.invalid_suppressions = [];
		const summary = renderCheckRunSummary(report, context);
		expect(summary).toContain("### ⚠️ Warnings");
		expect(summary).toContain("Suggested change:");
		expect(summary).not.toContain("```suggestion");
	});

	it("omits a replacement block that straddles the size limit", () => {
		const report = exampleReport();
		const oversized = report.findings[0];
		if (oversized === undefined) {
			throw new Error("The example report has findings.");
		}
		oversized.suggested_change = "const filler = 1;\n".repeat(4_000);
		const summary = renderCheckRunSummary(report, context);
		expect(summary.length).toBeLessThanOrEqual(65_535);
		expect(summary.endsWith("… (truncated)")).toBe(true);
		expect(summary).not.toContain("const filler = 1;");
	});

	it("clamps an oversized surface outside a code block at the limit", () => {
		const report = exampleReport();
		const oversized = report.findings[0];
		if (oversized === undefined) {
			throw new Error("The example report has findings.");
		}
		oversized.reason = "The reason repeats. ".repeat(4_000);
		const summary = renderCheckRunSummary(report, context);
		expect(summary.length).toBeLessThanOrEqual(65_535);
		expect(summary.endsWith("… (truncated)")).toBe(true);
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
