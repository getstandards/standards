import { visibleWidth } from "@earendil-works/pi-tui";
import {
	modelReferenceSchema,
	type ReportedFinding,
	type ReviewReport,
} from "@getstandards/core";
import { describe, expect, it } from "vitest";
import { formatReportLines, type ReportStyle } from "./report-lines.js";

/** A style that returns the text unchanged, so a test asserts on the words. */
const plainStyle: ReportStyle = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

/** A style that marks each color, so a test asserts on the semantic color. */
const taggedStyle: ReportStyle = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => text,
};

const finding: ReportedFinding = {
	rule: "money.no-float",
	level: "MUST",
	title: "Money must not be a floating-point number.",
	path: "src/invoice.ts",
	lines: [12, 14],
	evidence: "const total = subtotal * 1.2",
	reason: "The total is a floating-point number.",
	suggestion: "Hold the total in integer cents.",
	suggested_change: "const totalCents = subtotalCents * 120n / 100n;",
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
		counts: { resolved_rules: 4, selected_rules: 2, evaluation_tasks: 1 },
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

/** Render with the plain style and join, for a readable assertion. */
function renderPlain(
	value: ReviewReport,
	options: { width?: number; expanded?: boolean } = {},
): string {
	return formatReportLines(value, {
		style: plainStyle,
		width: options.width ?? 80,
		expanded: options.expanded ?? false,
	}).join("\n");
}

describe("formatReportLines", () => {
	it("leads with the conclusion, the counts, and the cost", () => {
		const text = renderPlain(report());

		expect(text).toContain("Standards review");
		expect(text).toContain("✖ non-compliant");
		expect(text).toContain("1 blocking");
		expect(text).toContain("0 warnings");
		expect(text).toContain("$0.1234");
	});

	it("marks a subscription cost as an estimate", () => {
		const subscription = report();
		subscription.usage.cost_basis = "list_price_estimate";

		expect(renderPlain(subscription)).toContain("about $0.1234");
	});

	it("omits the cost when the models have no per-token price", () => {
		const free = report();
		free.usage.cost_basis = "none";

		expect(renderPlain(free)).not.toContain("$");
	});

	it("says what was checked when a review found nothing", () => {
		const text = renderPlain(report({ conclusion: "compliant", findings: [] }));

		expect(text).toContain("✔ compliant");
		expect(text).toContain("2 rules checked, nothing to fix.");
	});

	it("gives the location, the rule, and the reason when collapsed", () => {
		const text = renderPlain(report());

		expect(text).toContain("src/invoice.ts:12-14");
		expect(text).toContain("money.no-float");
		expect(text).toContain("The total is a floating-point number.");
		// The detail belongs to the expanded report, so it stays out of the way.
		expect(text).not.toContain("const total = subtotal * 1.2");
		expect(text).not.toContain("Suggested change:");
	});

	it("adds the evidence and the suggested change when expanded", () => {
		const text = renderPlain(report(), { expanded: true });

		expect(text).toContain("const total = subtotal * 1.2");
		expect(text).toContain("Hold the total in integer cents.");
		expect(text).toContain("Suggested change:");
		expect(text).toContain("const totalCents = subtotalCents * 120n / 100n;");
	});

	it("shows one line number when a finding covers one line", () => {
		const single = report({ findings: [{ ...finding, lines: [12, 12] }] });

		expect(renderPlain(single)).toContain("src/invoice.ts:12");
		expect(renderPlain(single)).not.toContain("12-12");
	});

	it("holds back the findings past the collapsed limit and says how many", () => {
		const many = report({
			findings: Array.from({ length: 8 }, (_unused, index) => ({
				...finding,
				path: `src/file-${index}.ts`,
			})),
		});

		const collapsed = renderPlain(many);
		expect(collapsed).toContain("src/file-4.ts");
		expect(collapsed).not.toContain("src/file-5.ts");
		expect(collapsed).toContain("… 3 more findings");

		const expanded = renderPlain(many, { expanded: true });
		expect(expanded).toContain("src/file-7.ts");
		expect(expanded).not.toContain("more findings");
	});

	it("reports skipped knowledge documents without failing the review", () => {
		const withWarnings = report({
			warnings: [{ document: "knowledge/broken.md", problem: "no title" }],
		});

		expect(renderPlain(withWarnings)).toContain("1 knowledge document skipped");
	});

	it("colors a blocking finding as an error and an advisory one as a warning", () => {
		const mixed = report({
			findings: [finding, { ...finding, level: "SHOULD" }],
		});
		const text = formatReportLines(mixed, {
			style: taggedStyle,
			width: 120,
			expanded: false,
		}).join("\n");

		expect(text).toContain("<error>✖</error>");
		expect(text).toContain("<warning>▲</warning>");
	});

	it("never renders a line wider than the viewport", () => {
		const narrow = report({
			findings: [
				{
					...finding,
					path: "src/a/very/deeply/nested/directory/tree/invoice-calculations.ts",
					reason: `A reason that runs well past any sensible terminal width. ${"word ".repeat(40)}`,
				},
			],
		});

		for (const width of [40, 60, 100]) {
			const lines = formatReportLines(narrow, {
				style: plainStyle,
				width,
				expanded: true,
			});
			const widest = Math.max(...lines.map((line) => visibleWidth(line)));
			expect(widest).toBeLessThanOrEqual(width);
		}
	});
});
