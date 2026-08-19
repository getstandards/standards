import { requirementLevels } from "../../config/configuration-schema.js";
import type { StepUsage } from "../../review/agent-usage.js";
import type {
	ReportedFinding,
	ReviewReport,
} from "../../review/review-report.js";

/**
 * Render the review report for a terminal (specs/review.md step 5).
 *
 * It shows the same information as the machine-readable report: the
 * conclusion, the model of each agent step, the counts, the usage, and every
 * finding. Rendering is deterministic and uses no model.
 */
export function renderReviewReportText(report: ReviewReport): string {
	const lines: string[] = [
		`Standards review: ${report.conclusion}`,
		"",
		`  Evaluation model:    ${report.models.evaluation}`,
		`  Verification model:  ${report.models.verification}`,
		`  Resolved rules:      ${report.counts.resolved_rules}`,
		`  Selected rules:      ${report.counts.selected_rules}`,
		`  Evaluation tasks:    ${report.counts.evaluation_tasks}`,
		`  Findings:            ${formatFindingLevels(report.findings)}`,
		`  Evaluation usage:    ${formatStepUsage(report.usage.evaluation)}`,
		`  Verification usage:  ${formatStepUsage(report.usage.verification)}`,
	];
	if (report.findings.length > 0) {
		lines.push("", "Findings:");
		for (const finding of report.findings) {
			lines.push("", ...formatFinding(finding));
		}
	}
	if (report.suppressed.length > 0) {
		lines.push("", "Suppressed findings:");
		for (const finding of report.suppressed) {
			lines.push(
				"",
				...formatFinding(finding),
				`    Suppressed: ${finding.suppression_reason}`,
			);
		}
	}
	if (report.invalid_suppressions.length > 0) {
		lines.push("", "Invalid suppression markers:");
		for (const marker of report.invalid_suppressions) {
			lines.push(`  ${marker.path}:${marker.line}  ${marker.reason}`);
		}
	}
	return lines.join("\n");
}

/** Count the findings for each requirement level, such as 'MUST NOT: 1'. */
function formatFindingLevels(findings: readonly ReportedFinding[]): string {
	const summary = requirementLevels
		.map((level) => ({
			level,
			count: findings.filter((finding) => finding.level === level).length,
		}))
		.filter(({ count }) => count > 0)
		.map(({ level, count }) => `${level}: ${count}`)
		.join(", ");
	return summary || "none";
}

/** Format one agent step's invocation and token counts. */
function formatStepUsage(usage: StepUsage): string {
	return `${usage.invocations} invocations, ${usage.input_tokens} input tokens, ${usage.output_tokens} output tokens`;
}

/** Format one finding with its location, rule, and report fields. */
function formatFinding(finding: ReportedFinding): string[] {
	const location =
		finding.lines[0] === finding.lines[1]
			? `${finding.path}:${finding.lines[0]}`
			: `${finding.path}:${finding.lines[0]}-${finding.lines[1]}`;
	const lines = [
		`  ${location}  ${finding.rule} (${finding.level})`,
		`    Evidence:   ${finding.evidence}`,
		`    Reason:     ${finding.reason}`,
	];
	if (finding.guidance !== undefined) {
		lines.push(`    Guidance:   ${finding.guidance}`);
	}
	if (finding.references !== undefined) {
		lines.push(`    References: ${finding.references.join(", ")}`);
	}
	return lines;
}
