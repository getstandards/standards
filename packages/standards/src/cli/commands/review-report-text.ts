import chalk from "chalk";
import figures from "figures";
import { requirementLevels } from "../../config/configuration-schema.js";
import type { RequirementLevel } from "../../config/index.js";
import { formatCost, type StepUsage } from "../../review/agent-usage.js";
import type {
	ReportedFinding,
	ReviewReport,
	ReviewUsage,
} from "../../review/review-report.js";

/**
 * Render the review report for a terminal (specs/review.md step 5).
 *
 * It shows the same information as the machine-readable report: the
 * conclusion, the model of each agent step, the counts, the usage, the
 * resolved Git sources, the loader warnings, and every finding. Rendering is
 * deterministic and uses no model. This is the plain rendering used when
 * standard output is not a terminal or when the report is captured, so it
 * stays free of color codes and decorative glyphs.
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
		`  Total cost:          ${formatTotalCost(report.usage)}`,
	];
	if (report.sources.length > 0) {
		lines.push("", "Knowledge sources:");
		for (const source of report.sources) {
			lines.push(
				`  ${source.repository} at ${source.branch}: ${source.commit}`,
			);
		}
	}
	if (report.warnings.length > 0) {
		lines.push("", "Warnings:");
		for (const warning of report.warnings) {
			lines.push(`  ${warning.document}: ${warning.problem}`);
		}
	}
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

/**
 * Render the review report for a human at an interactive terminal
 * (specs/review.md step 5).
 *
 * It shows the same information as the plain rendering, with a small semantic
 * color vocabulary: a green check for a compliant review, a red cross for a
 * non-compliant one, red marks for `MUST` findings, yellow warnings for
 * `SHOULD` findings, dim labels, and cyan counts. The calling command calls
 * this only when standard input and output are a terminal; otherwise
 * `chalk` renders the colors as plain text.
 */
export function renderReviewReportTerminal(report: ReviewReport): string {
	const compliant = report.conclusion === "compliant";
	const conclusionColor = compliant ? chalk.green : chalk.red;
	const conclusionIcon = compliant ? figures.tick : figures.cross;
	const lines: string[] = [
		`${conclusionColor(conclusionIcon)} ${chalk.bold(`Standards review: ${report.conclusion}`)}`,
		"",
		reviewField("Evaluation model:", report.models.evaluation),
		reviewField("Verification model:", report.models.verification),
		reviewField(
			"Resolved rules:",
			chalk.cyan(String(report.counts.resolved_rules)),
		),
		reviewField(
			"Selected rules:",
			chalk.cyan(String(report.counts.selected_rules)),
		),
		reviewField(
			"Evaluation tasks:",
			chalk.cyan(String(report.counts.evaluation_tasks)),
		),
		reviewField("Findings:", formatFindingLevelsTerminal(report.findings)),
		reviewField(
			"Evaluation usage:",
			chalk.dim(formatStepUsage(report.usage.evaluation)),
		),
		reviewField(
			"Verification usage:",
			chalk.dim(formatStepUsage(report.usage.verification)),
		),
		reviewField("Total cost:", chalk.dim(formatTotalCost(report.usage))),
	];
	if (report.sources.length > 0) {
		lines.push("", chalk.bold("Knowledge sources"));
		for (const source of report.sources) {
			lines.push(
				`  ${source.repository} at ${source.branch}: ${chalk.dim(source.commit)}`,
			);
		}
	}
	if (report.warnings.length > 0) {
		lines.push("", chalk.bold("Warnings"));
		for (const warning of report.warnings) {
			lines.push(
				`  ${chalk.yellow(figures.warning)} ${warning.document}: ${warning.problem}`,
			);
		}
	}
	if (report.findings.length > 0) {
		lines.push("", chalk.bold("Findings"));
		for (const finding of report.findings) {
			lines.push("", ...formatFindingTerminal(finding));
		}
	}
	if (report.suppressed.length > 0) {
		lines.push("", "Suppressed findings:");
		for (const finding of report.suppressed) {
			lines.push(
				"",
				...formatFindingTerminal(finding),
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

/** The padded label width that aligns the review report's summary values. */
const FIELD_WIDTH = 21;

/** One aligned label and value row of the report summary. */
function reviewField(label: string, value: string): string {
	return `  ${chalk.dim(label.padEnd(FIELD_WIDTH))}${value}`;
}

/** Count the findings for each requirement level, such as 'MUST: 1'. */
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

/** Count the findings by level, coloring each level with its semantic style. */
function formatFindingLevelsTerminal(
	findings: readonly ReportedFinding[],
): string {
	const summary = requirementLevels
		.map((level) => ({
			level,
			count: findings.filter((finding) => finding.level === level).length,
		}))
		.filter(({ count }) => count > 0)
		.map(({ level, count }) => levelStyle(level).style(`${level}: ${count}`))
		.join(", ");
	return summary || chalk.dim("none");
}

/** Format one agent step's invocation and token counts and its cost. */
function formatStepUsage(usage: StepUsage): string {
	return `${usage.invocations} invocations, ${usage.input_tokens} input tokens, ${usage.output_tokens} output tokens, ${formatCost(usage.cost)}`;
}

/** The review's total cost, with a note when the value is not a charge. */
function formatTotalCost(usage: ReviewUsage): string {
	const cost = formatCost(usage.total_cost);
	switch (usage.cost_basis) {
		case "charged":
			return cost;
		case "list_price_estimate":
			return `${cost} (list price estimate, not a charge)`;
		case "none":
			return `${cost} (the models have no per-token price)`;
	}
}

/** The line number(s) of one finding as a path with a line range. */
function formatFindingLocation(finding: ReportedFinding): string {
	return finding.lines[0] === finding.lines[1]
		? `${finding.path}:${finding.lines[0]}`
		: `${finding.path}:${finding.lines[0]}-${finding.lines[1]}`;
}

/** Format one finding with its location, rule, and report fields. */
function formatFinding(finding: ReportedFinding): string[] {
	const lines = [
		`  ${formatFindingLocation(finding)}  ${finding.rule} (${finding.level})`,
		`    Rule:       ${finding.title}`,
		`    Evidence:   ${finding.evidence}`,
		`    Reason:     ${finding.reason}`,
	];
	if (finding.suggestion !== undefined) {
		lines.push(`    Suggestion: ${finding.suggestion}`);
	}
	if (finding.suggested_change !== undefined) {
		// The replacement keeps its own line boundaries; it is shown, never
		// truncated (specs/review.md text rendering).
		lines.push("    Suggested change:", finding.suggested_change);
	}
	return lines;
}

/** Format one finding for a terminal, coloring its level and highlighting. */
function formatFindingTerminal(finding: ReportedFinding): string[] {
	const level = levelStyle(finding.level);
	const lines = [
		`  ${level.style(level.marker)} ${chalk.bold(formatFindingLocation(finding))}  ${chalk.cyan(finding.rule)} ${level.style(`(${finding.level})`)}`,
		`    ${chalk.dim("Rule:")}       ${finding.title}`,
		`    ${chalk.dim("Evidence:")}   ${finding.evidence}`,
		`    ${chalk.dim("Reason:")}     ${finding.reason}`,
	];
	if (finding.suggestion !== undefined) {
		lines.push(`    ${chalk.dim("Suggestion:")} ${finding.suggestion}`);
	}
	if (finding.suggested_change !== undefined) {
		lines.push(
			`    ${chalk.dim("Suggested change:")}`,
			finding.suggested_change,
		);
	}
	return lines;
}

/** The terminal style and marker for one requirement level. */
interface LevelStyle {
	marker: string;
	style: (text: string) => string;
}

/** The semantic style for a requirement level, mirroring a severity scale. */
function levelStyle(level: RequirementLevel): LevelStyle {
	switch (level) {
		case "MUST":
			return { marker: figures.cross, style: chalk.red };
		case "SHOULD":
			return { marker: figures.warning, style: chalk.yellow };
	}
}
