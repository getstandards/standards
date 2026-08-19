import type { Rule } from "../config/index.js";
import type { StepUsage } from "./agent-usage.js";
import type { Finding } from "./finding.js";
import type { ModelReference } from "./model-reference.js";

/** The overall outcome of a review (specs/review.md step 5). */
export type ReviewConclusion = "compliant" | "non-compliant";

/** One confirmed finding with the rule fields the report shows. */
export interface ReportedFinding {
	rule: string;
	level: Rule["level"];
	path: string;
	lines: [number, number];
	evidence: string;
	reason: string;
	guidance?: string;
	references?: string[];
}

/**
 * A suppressed finding in the report.
 *
 * Version 1 does not implement suppressions, so `suppressed` is always empty.
 * The key stays in the report shape defined by specs/suppressions.md.
 */
export interface SuppressedFinding extends ReportedFinding {
	suppression_reason: string;
}

/**
 * An invalid suppression marker in the report.
 *
 * Version 1 does not implement suppressions, so `invalid_suppressions` is always
 * empty. The key stays in the report shape defined by specs/suppressions.md.
 */
export interface InvalidSuppression {
	path: string;
	line: number;
	reason: string;
}

/** The counts a report shows (specs/review.md step 5). */
export interface ReviewCounts {
	resolved_rules: number;
	selected_rules: number;
	evaluation_tasks: number;
}

/**
 * The one report data shape that every review surface renders (specs/review.md).
 *
 * `JSON.stringify` of this object is the machine-readable report for
 * `--format json`. A text surface renders the same fields.
 */
export interface ReviewReport {
	version: 1;
	conclusion: ReviewConclusion;
	models: { evaluation: ModelReference; verification: ModelReference };
	counts: ReviewCounts;
	usage: { evaluation: StepUsage; verification: StepUsage };
	findings: ReportedFinding[];
	suppressed: SuppressedFinding[];
	invalid_suppressions: InvalidSuppression[];
}

/** The confirmed findings and the counts and usage a report is built from. */
export interface ReportInput {
	models: { evaluation: ModelReference; verification: ModelReference };
	counts: ReviewCounts;
	usage: { evaluation: StepUsage; verification: StepUsage };
	confirmedFindings: readonly Finding[];
	ruleSet: readonly Rule[];
}

/**
 * Build the review report from the confirmed findings (specs/review.md step 5).
 *
 * It attaches each rule's level, guidance, and references to its findings,
 * sorts the findings by path, then line, then rule id, and computes the
 * conclusion: non-compliant when at least one confirmed `MUST` or `MUST NOT`
 * finding is present, compliant otherwise.
 */
export function buildReviewReport(input: ReportInput): ReviewReport {
	const rulesById = new Map(input.ruleSet.map((rule) => [rule.id, rule]));
	const findings = input.confirmedFindings
		.map((finding) => toReportedFinding(finding, rulesById.get(finding.rule)))
		.filter((finding): finding is ReportedFinding => finding !== undefined)
		.sort(compareFindings);

	const conclusion: ReviewConclusion = findings.some(
		(finding) => finding.level === "MUST" || finding.level === "MUST NOT",
	)
		? "non-compliant"
		: "compliant";

	return {
		version: 1,
		conclusion,
		models: input.models,
		counts: input.counts,
		usage: input.usage,
		findings,
		suppressed: [],
		invalid_suppressions: [],
	};
}

/** Attach a rule's report fields to a finding, or drop a finding with no rule. */
function toReportedFinding(
	finding: Finding,
	rule: Rule | undefined,
): ReportedFinding | undefined {
	if (rule === undefined) {
		return undefined;
	}
	const reported: ReportedFinding = {
		rule: finding.rule,
		level: rule.level,
		path: finding.path,
		lines: finding.lines,
		evidence: finding.evidence,
		reason: finding.reason,
	};
	if (rule.guidance !== undefined) {
		reported.guidance = rule.guidance;
	}
	if (rule.references !== undefined) {
		reported.references = rule.references;
	}
	return reported;
}

/** Order findings by path, then first line, then rule id. */
function compareFindings(a: ReportedFinding, b: ReportedFinding): number {
	return (
		a.path.localeCompare(b.path) ||
		a.lines[0] - b.lines[0] ||
		a.rule.localeCompare(b.rule)
	);
}
