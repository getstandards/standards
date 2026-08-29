import {
	modelReferenceSchema,
	type ReportedFinding,
	type ReviewReport,
} from "@getstandards/core";
import { describe, expect, it } from "vitest";
import {
	formatFindingLine,
	formatFindingsMessage,
	formatReviewSummary,
} from "./review-message.js";

const finding: ReportedFinding = {
	rule: "money.no-float",
	level: "MUST",
	title: "Money must not be a floating-point number.",
	path: "invoice.ts",
	lines: [1, 1],
	evidence: "const total = subtotal * 1.2",
	reason: "The total is a floating-point number.",
	suggested_change: "const total = subtotalCents * 120n / 100n;",
};

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
	const emptyStep = {
		invocations: 0,
		input_tokens: 0,
		output_tokens: 0,
		cache_read_tokens: 0,
		cache_write_tokens: 0,
		cost: 0,
	};
	return {
		version: 3,
		conclusion: "non-compliant",
		models: {
			evaluation: modelReferenceSchema.parse("anthropic/claude-sonnet-5"),
			verification: modelReferenceSchema.parse("anthropic/claude-sonnet-5"),
		},
		counts: { resolved_rules: 1, selected_rules: 1, evaluation_tasks: 1 },
		usage: {
			evaluation: emptyStep,
			verification: emptyStep,
			total_cost: 0.1234,
			cost_basis: "charged",
		},
		sources: [],
		warnings: [],
		findings: [finding],
		suppressed: [],
		invalid_suppressions: [],
		...overrides,
	};
}

describe("formatReviewSummary", () => {
	it("names the conclusion, the counts, and the charged cost", () => {
		expect(formatReviewSummary(report())).toBe(
			"Standards review: non-compliant. 1 blocking, 0 warnings, $0.1234.",
		);
	});

	it("marks a subscription cost as an estimate", () => {
		const subscription = report();
		subscription.usage.cost_basis = "list_price_estimate";

		expect(formatReviewSummary(subscription)).toContain("about $0.1234");
	});

	it("omits the cost when every selected model is free", () => {
		const free = report({ conclusion: "compliant", findings: [] });
		free.usage.cost_basis = "none";

		expect(formatReviewSummary(free)).toBe(
			"Standards review: compliant. 0 blocking, 0 warnings.",
		);
	});
});

describe("formatFindingLine", () => {
	it("names the level, the rule, the path, and the lines", () => {
		expect(formatFindingLine(finding)).toBe(
			"blocking money.no-float invoice.ts:1",
		);
		expect(
			formatFindingLine({ ...finding, lines: [3, 7], level: "SHOULD" }),
		).toBe("warning money.no-float invoice.ts:3-7");
	});
});

describe("formatFindingsMessage", () => {
	it("carries what an agent needs to fix the finding", () => {
		const message = formatFindingsMessage(report());

		expect(message).toContain("money.no-float");
		expect(message).toContain("invoice.ts:1-1");
		expect(message).toContain("const total = subtotal * 1.2");
		expect(message).toContain("The total is a floating-point number.");
		expect(message).toContain("const total = subtotalCents * 120n / 100n;");
	});

	it("tells the agent to change nothing when the review found nothing", () => {
		const message = formatFindingsMessage(
			report({ conclusion: "compliant", findings: [] }),
		);

		expect(message).toContain("No findings.");
		expect(message).toContain("Do not change the code");
	});
});
