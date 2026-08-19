import { describe, expect, it } from "vitest";
import type { ModelReference } from "../../review/model-reference.js";
import type { ReviewReport } from "../../review/review-report.js";
import { renderReviewReportText } from "./review-report-text.js";

const model = "anthropic/claude-sonnet-5" as ModelReference;

function reportWith(overrides: Partial<ReviewReport>): ReviewReport {
	return {
		version: 1,
		conclusion: "compliant",
		models: { evaluation: model, verification: model },
		counts: { resolved_rules: 2, selected_rules: 0, evaluation_tasks: 0 },
		usage: {
			evaluation: { invocations: 0, input_tokens: 0, output_tokens: 0 },
			verification: { invocations: 0, input_tokens: 0, output_tokens: 0 },
		},
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
  Evaluation usage:    0 invocations, 0 input tokens, 0 output tokens
  Verification usage:  0 invocations, 0 input tokens, 0 output tokens`,
		);
	});

	it("renders each finding with its rule fields", () => {
		const report = reportWith({
			conclusion: "non-compliant",
			counts: { resolved_rules: 2, selected_rules: 1, evaluation_tasks: 1 },
			usage: {
				evaluation: { invocations: 1, input_tokens: 500, output_tokens: 40 },
				verification: { invocations: 1, input_tokens: 200, output_tokens: 10 },
			},
			findings: [
				{
					rule: "money.no-float",
					level: "MUST NOT",
					path: "src/invoice.ts",
					lines: [41, 44],
					evidence: "const total = subtotal * 1.2",
					reason: "The total is a floating-point number.",
					guidance: "Use an integer in the smallest currency unit.",
					references: ["https://example.com/money"],
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
  Findings:            MUST NOT: 1
  Evaluation usage:    1 invocations, 500 input tokens, 40 output tokens
  Verification usage:  1 invocations, 200 input tokens, 10 output tokens

Findings:

  src/invoice.ts:41-44  money.no-float (MUST NOT)
    Evidence:   const total = subtotal * 1.2
    Reason:     The total is a floating-point number.
    Guidance:   Use an integer in the smallest currency unit.
    References: https://example.com/money`,
		);
	});
});
