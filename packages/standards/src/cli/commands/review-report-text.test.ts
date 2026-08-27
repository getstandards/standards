import { describe, expect, it } from "vitest";
import type { ModelReference } from "../../review/model-reference.js";
import type { ReviewReport } from "../../review/review-report.js";
import {
	renderReviewReportTerminal,
	renderReviewReportText,
} from "./review-report-text.js";

const model = "anthropic/claude-sonnet-5" as ModelReference;

function reportWith(overrides: Partial<ReviewReport>): ReviewReport {
	return {
		version: 3,
		conclusion: "compliant",
		models: { evaluation: model, verification: model },
		counts: { resolved_rules: 2, selected_rules: 0, evaluation_tasks: 0 },
		usage: {
			evaluation: {
				invocations: 0,
				input_tokens: 0,
				cache_read_tokens: 0,
				cache_write_tokens: 0,
				output_tokens: 0,
				cost: 0,
			},
			verification: {
				invocations: 0,
				input_tokens: 0,
				cache_read_tokens: 0,
				cache_write_tokens: 0,
				output_tokens: 0,
				cost: 0,
			},
			total_cost: 0,
			cost_basis: "charged",
		},
		sources: [],
		warnings: [],
		findings: [],
		suppressed: [],
		invalid_suppressions: [],
		...overrides,
	};
}

describe("renderReviewReportText", () => {
	it("renders a compliant report without findings", () => {
		expect(renderReviewReportText(reportWith({}))).toBe(
			`Standards review: compliant

  Evaluation model:    anthropic/claude-sonnet-5
  Verification model:  anthropic/claude-sonnet-5
  Resolved rules:      2
  Selected rules:      0
  Evaluation tasks:    0
  Findings:            none
  Evaluation usage:    0 invocations, 0 input tokens, 0 output tokens, $0.0000
  Verification usage:  0 invocations, 0 input tokens, 0 output tokens, $0.0000
  Total cost:          $0.0000`,
		);
	});

	it("renders each finding with its rule fields", () => {
		const report = reportWith({
			conclusion: "non-compliant",
			counts: { resolved_rules: 2, selected_rules: 1, evaluation_tasks: 1 },
			usage: {
				evaluation: {
					invocations: 1,
					input_tokens: 500,
					cache_read_tokens: 0,
					cache_write_tokens: 0,
					output_tokens: 40,
					cost: 0.0421,
				},
				verification: {
					invocations: 1,
					input_tokens: 200,
					cache_read_tokens: 0,
					cache_write_tokens: 0,
					output_tokens: 10,
					cost: 0.0102,
				},
				total_cost: 0.0523,
				cost_basis: "list_price_estimate",
			},
			findings: [
				{
					rule: "money.no-float",
					level: "MUST",
					title: "Money must not be a floating-point number.",
					path: "src/invoice.ts",
					lines: [41, 44],
					evidence: "const total = subtotal * 1.2",
					reason: "The total is a floating-point number.",
					suggestion: "Use an integer in the smallest currency unit.",
				},
			],
		});

		expect(renderReviewReportText(report)).toBe(
			`Standards review: non-compliant

  Evaluation model:    anthropic/claude-sonnet-5
  Verification model:  anthropic/claude-sonnet-5
  Resolved rules:      2
  Selected rules:      1
  Evaluation tasks:    1
  Findings:            MUST: 1
  Evaluation usage:    1 invocations, 500 input tokens, 40 output tokens, $0.0421
  Verification usage:  1 invocations, 200 input tokens, 10 output tokens, $0.0102
  Total cost:          $0.0523 (list price estimate, not a charge)

Findings:

  src/invoice.ts:41-44  money.no-float (MUST)
    Rule:       Money must not be a floating-point number.
    Evidence:   const total = subtotal * 1.2
    Reason:     The total is a floating-point number.
    Suggestion: Use an integer in the smallest currency unit.`,
		);
	});

	it("renders the knowledge sources and warnings when present", () => {
		const rendered = renderReviewReportText(
			reportWith({
				sources: [
					{
						repository: "https://github.com/example/knowledge",
						branch: "main",
						commit: "0123456789abcdef0123456789abcdef01234567",
					},
				],
				warnings: [
					{
						document: "knowledge/decisions/bad.md",
						problem: "The document has no frontmatter block.",
					},
				],
			}),
		);

		expect(rendered).toContain(
			`Knowledge sources:
  https://github.com/example/knowledge at main: 0123456789abcdef0123456789abcdef01234567`,
		);
		expect(rendered).toContain(
			`Warnings:
  knowledge/decisions/bad.md: The document has no frontmatter block.`,
		);
	});

	it("shows the suggested change under its finding with a label", () => {
		const report = reportWith({
			conclusion: "non-compliant",
			counts: { resolved_rules: 2, selected_rules: 1, evaluation_tasks: 1 },
			findings: [
				{
					rule: "money.no-float",
					level: "MUST",
					title: "Money must not be a floating-point number.",
					path: "src/invoice.ts",
					lines: [41, 44],
					evidence: "const total = subtotal * 1.2",
					reason: "The total is a floating-point number.",
					suggested_change:
						"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
				},
			],
		});

		const rendered = renderReviewReportText(report);
		expect(rendered).toContain("    Suggested change:");
		expect(rendered).toContain(
			"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
		);
	});

	describe("renderReviewReportTerminal", () => {
		it("marks a compliant review with a green check", () => {
			const rendered = renderReviewReportTerminal(reportWith({}));

			// chalk renders plain text when stdout is not a terminal, so the
			// test asserts the glyph and labels, not escape codes.
			expect(rendered).toContain("✔ Standards review: compliant");
			expect(rendered).toContain("Evaluation model:");
			expect(rendered).toContain("Resolved rules:");
			expect(rendered).not.toContain("✘");
		});

		it("marks a MUST finding with a red cross", () => {
			const rendered = renderReviewReportTerminal(
				reportWith({
					conclusion: "non-compliant",
					findings: [
						{
							rule: "money.no-float",
							level: "MUST",
							title: "Money must not be a floating-point number.",
							path: "src/invoice.ts",
							lines: [41, 44],
							evidence: "const total = subtotal * 1.2",
							reason: "The total is a floating-point number.",
							suggestion: "Use an integer in the smallest currency unit.",
						},
					],
				}),
			);

			expect(rendered).toContain("✘ Standards review: non-compliant");
			expect(rendered).toContain(
				"✘ src/invoice.ts:41-44  money.no-float (MUST)",
			);
			expect(rendered).toContain(
				"Rule:       Money must not be a floating-point number.",
			);
			expect(rendered).toContain("Evidence:");
			expect(rendered).toContain(
				"Suggestion: Use an integer in the smallest currency unit.",
			);
		});

		it("marks a SHOULD finding with a yellow warning", () => {
			const rendered = renderReviewReportTerminal(
				reportWith({
					conclusion: "non-compliant",
					findings: [
						{
							rule: "mixins.document-overrides",
							level: "SHOULD",
							title: "Document every mixin override.",
							path: "src/prefs.ts",
							lines: [7, 7],
							evidence: "// no justification",
							reason: "The change overrides a mixin without a note.",
						},
					],
				}),
			);

			expect(rendered).toContain(
				"⚠ src/prefs.ts:7  mixins.document-overrides (SHOULD)",
			);
		});

		it("renders the knowledge sources and warnings sections", () => {
			const rendered = renderReviewReportTerminal(
				reportWith({
					sources: [
						{
							repository: "https://github.com/example/knowledge",
							branch: "main",
							commit: "0123456789abcdef0123456789abcdef01234567",
						},
					],
					warnings: [
						{
							document: "knowledge/decisions/bad.md",
							problem: "The document has no frontmatter block.",
						},
					],
				}),
			);

			expect(rendered).toContain("Knowledge sources");
			expect(rendered).toContain(
				"https://github.com/example/knowledge at main:",
			);
			expect(rendered).toContain("Warnings");
			expect(rendered).toContain(
				"knowledge/decisions/bad.md: The document has no frontmatter block.",
			);
		});
	});

	describe("renderReviewReportText", () => {
		it("stays free of decorative glyphs", () => {
			const rendered = renderReviewReportText(
				reportWith({
					conclusion: "non-compliant",
					findings: [
						{
							rule: "money.no-float",
							level: "MUST",
							title: "Money must not be a floating-point number.",
							path: "src/invoice.ts",
							lines: [41, 44],
							evidence: "const total = subtotal * 1.2",
							reason: "The total is a floating-point number.",
						},
					],
				}),
			);

			expect(rendered).not.toContain("✔");
			expect(rendered).not.toContain("✘");
			expect(rendered).not.toContain("⚠");
		});
	});
});
