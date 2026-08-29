import { describe, expect, it } from "vitest";
import type { Rule } from "../rules/rule.js";
import { emptyStepUsage } from "./agent-usage.js";
import type { Finding } from "./finding.js";
import { modelReferenceSchema } from "./model-reference.js";
import { buildReviewReport } from "./review-report.js";

const models = {
	evaluation: modelReferenceSchema.parse("anthropic/claude-sonnet-5"),
	verification: modelReferenceSchema.parse("anthropic/claude-opus-5"),
};
const counts = { resolved_rules: 5, selected_rules: 2, evaluation_tasks: 1 };
const usage = { evaluation: emptyStepUsage(), verification: emptyStepUsage() };
const costBasis = "charged" as const;

function rule(overrides: Partial<Rule> & Pick<Rule, "id" | "level">): Rule {
	return {
		folder: "decisions",
		title: "rule statement",
		body: "rationale",
		...overrides,
	};
}

function finding(overrides: Partial<Finding> & Pick<Finding, "rule">): Finding {
	return {
		path: "src/a.ts",
		lines: [1, 1],
		evidence: "evidence",
		reason: "reason",
		...overrides,
	};
}

describe("buildReviewReport", () => {
	it("is non-compliant with a MUST finding and attaches rule fields", () => {
		const report = buildReviewReport({
			models,
			counts,
			usage,
			costBasis,
			confirmedFindings: [
				finding({
					rule: "money.no-float",
					suggestion: "Use the Money value object.",
				}),
			],
			ruleSet: [
				rule({
					id: "money.no-float",
					level: "MUST",
					title: "Money must not be a floating-point number.",
					description: "Store money in minor units.",
				}),
			],
		});

		expect(report.conclusion).toBe("non-compliant");
		expect(report.findings[0]?.level).toBe("MUST");
		expect(report.findings[0]?.title).toBe(
			"Money must not be a floating-point number.",
		);
		expect(report.findings[0]?.description).toBe("Store money in minor units.");
		expect(report.findings[0]?.suggestion).toBe("Use the Money value object.");
		expect(report.sources).toEqual([]);
		expect(report.warnings).toEqual([]);
		expect(report.suppressed).toEqual([]);
		expect(report.invalid_suppressions).toEqual([]);
	});

	it("omits the description of a rule without one", () => {
		const report = buildReviewReport({
			models,
			counts,
			usage,
			costBasis,
			confirmedFindings: [finding({ rule: "money.no-float" })],
			ruleSet: [rule({ id: "money.no-float", level: "MUST" })],
		});

		expect(report.findings[0]?.description).toBeUndefined();
	});

	it("reports version 3 and the accepted suggested change", () => {
		const report = buildReviewReport({
			models,
			counts,
			usage,
			costBasis,
			confirmedFindings: [
				finding({
					rule: "money.no-float",
					suggestedChange:
						"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
				}),
			],
			ruleSet: [rule({ id: "money.no-float", level: "MUST" })],
		});

		expect(report.version).toBe(3);
		expect(report.findings[0]?.suggested_change).toBe(
			"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
		);
	});

	it("carries the sources and warnings through to the report", () => {
		const report = buildReviewReport({
			models,
			counts,
			usage,
			costBasis,
			confirmedFindings: [],
			ruleSet: [],
			sources: [
				{
					repository: "https://example.com/standards.git",
					branch: "main",
					commit: "0123456789012345678901234567890123456789",
				},
			],
			warnings: [{ document: "standards/broken.md", problem: "missing level" }],
		});

		expect(report.sources).toEqual([
			{
				repository: "https://example.com/standards.git",
				branch: "main",
				commit: "0123456789012345678901234567890123456789",
			},
		]);
		expect(report.warnings).toEqual([
			{ document: "standards/broken.md", problem: "missing level" },
		]);
	});

	it("is compliant when every confirmed finding is a SHOULD warning", () => {
		const report = buildReviewReport({
			models,
			counts,
			usage,
			costBasis,
			confirmedFindings: [finding({ rule: "style.prefer-const" })],
			ruleSet: [rule({ id: "style.prefer-const", level: "SHOULD" })],
		});

		expect(report.conclusion).toBe("compliant");
		expect(report.findings).toHaveLength(1);
	});

	it("sorts findings by path, then line, then rule id", () => {
		const report = buildReviewReport({
			models,
			counts,
			usage,
			costBasis,
			confirmedFindings: [
				finding({ rule: "b.rule", path: "src/b.ts", lines: [5, 5] }),
				finding({ rule: "a.rule", path: "src/a.ts", lines: [9, 9] }),
				finding({ rule: "a.rule", path: "src/a.ts", lines: [2, 2] }),
			],
			ruleSet: [
				rule({ id: "a.rule", level: "SHOULD" }),
				rule({ id: "b.rule", level: "SHOULD" }),
			],
		});

		expect(
			report.findings.map((entry) => [entry.path, entry.lines[0]]),
		).toEqual([
			["src/a.ts", 2],
			["src/a.ts", 9],
			["src/b.ts", 5],
		]);
	});

	it("carries the step costs, their total, and the cost basis", () => {
		const report = buildReviewReport({
			models,
			counts,
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
					invocations: 2,
					input_tokens: 3900,
					cache_read_tokens: 0,
					cache_write_tokens: 0,
					output_tokens: 240,
					cost: 0.0102,
				},
			},
			costBasis: "list_price_estimate",
			confirmedFindings: [],
			ruleSet: [],
		});

		expect(report.usage.evaluation.cost).toBe(0.0421);
		expect(report.usage.verification.cost).toBe(0.0102);
		expect(report.usage.total_cost).toBeCloseTo(0.0523, 10);
		expect(report.usage.cost_basis).toBe("list_price_estimate");
	});
});
