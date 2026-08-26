import type { RequirementLevel } from "../config/index.js";
import type { Rule } from "../rules/rule.js";
import type { ResolvedGitSource, RuleWarning } from "../rules/rules-loader.js";
import type { StepUsage } from "./agent-usage.js";
import type { Finding } from "./finding.js";
import type { ModelReference } from "./model-reference.js";

/** The overall outcome of a review (specs/review.md step 5). */
export type ReviewConclusion = "compliant" | "non-compliant";

/** One confirmed finding with the rule fields the report shows. */
export interface ReportedFinding {
	rule: string;
	level: RequirementLevel;
	/** The rule statement of the knowledge document. */
	title: string;
	/** The one-line summary of the knowledge document, when it has one. */
	description?: string;
	path: string;
	lines: [number, number];
	evidence: string;
	reason: string;
	/** The agent's remediation advice, specific to this change. */
	suggestion?: string;
	/** The accepted exact replacement for `lines`, when evaluation proposed one. */
	suggested_change?: string;
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
 * What the review's cost number means (specs/review.md step 5).
 *
 * `charged` is a real charge through an API key credential.
 * `list_price_estimate` is what the tokens would have cost through the API;
 * a subscription credential does not charge per token. `none` means every
 * selected model has a zero cost, so the number carries no information.
 */
export type CostBasis = "charged" | "list_price_estimate" | "none";

/** The model usage and cost of one review, as the report shows it. */
export interface ReviewUsage {
	evaluation: StepUsage;
	verification: StepUsage;
	/** The sum of the step costs, in United States dollars. */
	total_cost: number;
	cost_basis: CostBasis;
}

/**
 * The one report data shape that every review surface renders (specs/review.md).
 *
 * `JSON.stringify` of this object is the machine-readable report for
 * `--format json`. A text surface renders the same fields.
 */
export interface ReviewReport {
	/**
	 * Version 3 reads rules from knowledge documents: findings carry `title`
	 * and `suggestion`, and the report records the resolved commit of each Git
	 * source and the warnings for skipped documents.
	 */
	version: 3;
	conclusion: ReviewConclusion;
	models: { evaluation: ModelReference; verification: ModelReference };
	counts: ReviewCounts;
	usage: ReviewUsage;
	/** The resolved commit of each Git knowledge source, for traceability. */
	sources: ResolvedGitSource[];
	/** The knowledge documents the loader skipped, with each problem. */
	warnings: RuleWarning[];
	findings: ReportedFinding[];
	suppressed: SuppressedFinding[];
	invalid_suppressions: InvalidSuppression[];
}

/** The confirmed findings and the counts and usage a report is built from. */
export interface ReportInput {
	models: { evaluation: ModelReference; verification: ModelReference };
	counts: ReviewCounts;
	usage: { evaluation: StepUsage; verification: StepUsage };
	costBasis: CostBasis;
	confirmedFindings: readonly Finding[];
	ruleSet: readonly Rule[];
	sources?: readonly ResolvedGitSource[];
	warnings?: readonly RuleWarning[];
}

/**
 * Build the review report from the confirmed findings (specs/review.md step 5).
 *
 * It attaches each rule's level and title to its findings, sorts the findings
 * by path, then line, then rule id, and computes the conclusion:
 * non-compliant when at least one confirmed `MUST` finding is present,
 * compliant otherwise.
 */
export function buildReviewReport(input: ReportInput): ReviewReport {
	const rulesById = new Map(input.ruleSet.map((rule) => [rule.id, rule]));
	const findings = input.confirmedFindings
		.map((finding) => toReportedFinding(finding, rulesById.get(finding.rule)))
		.filter((finding): finding is ReportedFinding => finding !== undefined)
		.sort(compareFindings);

	const conclusion: ReviewConclusion = findings.some(
		(finding) => finding.level === "MUST",
	)
		? "non-compliant"
		: "compliant";

	return {
		version: 3,
		conclusion,
		models: input.models,
		counts: input.counts,
		usage: {
			...input.usage,
			total_cost: input.usage.evaluation.cost + input.usage.verification.cost,
			cost_basis: input.costBasis,
		},
		sources: [...(input.sources ?? [])],
		warnings: [...(input.warnings ?? [])],
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
		title: rule.title,
		path: finding.path,
		lines: finding.lines,
		evidence: finding.evidence,
		reason: finding.reason,
	};
	if (rule.description !== "") {
		reported.description = rule.description;
	}
	if (finding.suggestion !== undefined) {
		reported.suggestion = finding.suggestion;
	}
	// The suggested change is report data only when verification accepted it.
	if (finding.suggestedChange !== undefined) {
		reported.suggested_change = finding.suggestedChange;
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
