import {
	modelReferenceSchema,
	type ReportedFinding,
	type ReviewReport,
} from "@getstandards/core";
import { describe, expect, it } from "vitest";
import { deliverReviewReport } from "./index.js";
import { REVIEW_MESSAGE_TYPE } from "./report-renderer.js";
import { formatFindingsMessage } from "./review-message.js";

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

function report(): ReviewReport {
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
	};
}

describe("deliverReviewReport", () => {
	it("sends the report as one message without a delivery mode", () => {
		const reviewReport = report();
		const calls: { message: unknown; options: unknown }[] = [];
		const api = {
			sendMessage: (message: unknown, options?: unknown) => {
				calls.push({ message, options });
			},
		};

		deliverReviewReport(api, reviewReport);

		expect(calls).toHaveLength(1);
		const call = calls[0] as {
			message: {
				customType: string;
				content: string;
				display: boolean;
				details: ReviewReport;
			};
			options: unknown;
		};
		expect(call.message.customType).toBe(REVIEW_MESSAGE_TYPE);
		expect(call.message.content).toBe(formatFindingsMessage(reviewReport));
		expect(call.message.display).toBe(true);
		expect(call.message.details).toBe(reviewReport);
		// Default delivery appends the entry and renders it in the transcript
		// without starting a turn. `deliverAs: "nextTurn"` holds the message
		// back until the next user prompt and never renders it, which made a
		// finished review print nothing (regression).
		expect(call.options).toBeUndefined();
	});
});
