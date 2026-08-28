import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	formatCost,
	type ReportedFinding,
	type RequirementLevel,
	type ReviewReport,
} from "@getstandards/core";
import { countFindings } from "./review-message.js";

/**
 * The part of pi's theme the report reads.
 *
 * The report states the subset it needs instead of naming pi's `Theme` class,
 * so a test renders the same lines with a plain stub and asserts on the text.
 */
export interface ReportStyle {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
}

/** Everything the report layout needs beyond the report itself. */
export interface ReportLayout {
	style: ReportStyle;
	/** The viewport width in columns. No rendered line may be wider. */
	width: number;
	/** True when the reader expanded the message, which shows every detail. */
	expanded: boolean;
	/** The key hint that tells the reader how to expand, when there is more. */
	expandHint?: string;
	/** Syntax-highlight one code block, when the host can. */
	highlight?: (code: string, path: string) => string[];
}

/** How many findings the collapsed report lists before it stops. */
const COLLAPSED_FINDING_LIMIT = 5;

/** The marker and color of one requirement level, mirroring a severity scale. */
function levelStyle(level: RequirementLevel): {
	marker: string;
	color: ThemeColor;
} {
	return level === "MUST"
		? { marker: "✖", color: "error" }
		: { marker: "▲", color: "warning" };
}

/** One finding's location: its path with a line or a line range. */
function findingLocation(finding: ReportedFinding): string {
	const [first, last] = finding.lines;
	return first === last
		? `${finding.path}:${first}`
		: `${finding.path}:${first}-${last}`;
}

/** A full-width horizontal rule. */
function rule(layout: ReportLayout): string {
	return layout.style.fg("border", "─".repeat(Math.max(1, layout.width)));
}

/** A horizontal rule that carries a title on its left. */
function titledRule(title: string, layout: ReportLayout): string {
	const head = layout.style.fg("border", "──");
	const fill = Math.max(
		0,
		layout.width - visibleWidth(title) - visibleWidth(head) - 2,
	);
	return `${head} ${title} ${layout.style.fg("border", "─".repeat(fill))}`;
}

/**
 * Wrap prose to the viewport and indent every line it produced.
 *
 * The TUI resets styles at each line boundary, so the wrap runs on the styled
 * text and each returned line carries its own escape codes.
 */
function wrap(text: string, indent: string, layout: ReportLayout): string[] {
	const available = Math.max(1, layout.width - visibleWidth(indent));
	return wrapTextWithAnsi(text, available).map((line) => `${indent}${line}`);
}

/** The conclusion, the finding counts, and the cost, as one line. */
function summaryLine(report: ReviewReport, layout: ReportLayout): string {
	const { style } = layout;
	const { blocking, warning: warnings } = countFindings(report);
	const compliant = report.conclusion === "compliant";

	const parts = [
		style.fg(
			compliant ? "success" : "error",
			`${compliant ? "✔" : "✖"} ${report.conclusion}`,
		),
		style.fg(blocking > 0 ? "error" : "muted", `${blocking} blocking`),
		style.fg(
			warnings > 0 ? "warning" : "muted",
			`${warnings} warning${warnings === 1 ? "" : "s"}`,
		),
	];
	if (report.usage.cost_basis !== "none") {
		const cost = formatCost(report.usage.total_cost);
		parts.push(
			style.fg(
				"muted",
				report.usage.cost_basis === "list_price_estimate"
					? `about ${cost}`
					: cost,
			),
		);
	}
	return parts.join(style.fg("dim", " · "));
}

/**
 * One code block, syntax-highlighted when the host can.
 *
 * A dim gutter marks the block as quoted source, so a reader tells it from the
 * prose around it without a label. Source keeps its own line boundaries and is
 * cut to the viewport, never wrapped: a wrapped line of code reads as a
 * different line of code.
 */
function codeBlock(code: string, path: string, layout: ReportLayout): string[] {
	const lines = layout.highlight?.(code, path) ?? code.split("\n");
	const gutter = `    ${layout.style.fg("border", "│")} `;
	return lines.map((line) => truncateToWidth(`${gutter}${line}`, layout.width));
}

/** One finding's headline: its level marker, location, and rule id. */
function findingHeadline(
	finding: ReportedFinding,
	layout: ReportLayout,
): string {
	const { style } = layout;
	const level = levelStyle(finding.level);
	return truncateToWidth(
		`  ${style.fg(level.color, level.marker)} ${style.bold(
			findingLocation(finding),
		)}  ${style.fg("accent", finding.rule)} ${style.fg(
			level.color,
			finding.level,
		)}`,
		layout.width,
	);
}

/** One finding, with every detail an expanded report shows. */
function findingLines(
	finding: ReportedFinding,
	layout: ReportLayout,
): string[] {
	const { style } = layout;
	const lines = [findingHeadline(finding, layout)];
	lines.push(...wrap(style.fg("muted", finding.title), "    ", layout));
	lines.push(...wrap(finding.reason, "    ", layout));

	if (!layout.expanded) {
		return lines;
	}

	lines.push(...codeBlock(finding.evidence, finding.path, layout));
	if (finding.suggestion !== undefined) {
		lines.push(
			...wrap(
				`${style.fg("dim", "Fix:")} ${finding.suggestion}`,
				"    ",
				layout,
			),
		);
	}
	if (finding.suggested_change !== undefined) {
		lines.push(`    ${style.fg("dim", "Suggested change:")}`);
		lines.push(...codeBlock(finding.suggested_change, finding.path, layout));
	}
	return lines;
}

/**
 * Render one review report as terminal lines (specs/pi.md reporting).
 *
 * The collapsed report answers the one question a reader has after a review:
 * what must I fix, and where. The expanded report adds the evidence, the
 * remediation advice, and the suggested change of every finding. Rendering is
 * deterministic and uses no model.
 */
export function formatReportLines(
	report: ReviewReport,
	layout: ReportLayout,
): string[] {
	const { style } = layout;
	const lines: string[] = [
		titledRule(style.fg("accent", style.bold("Standards review")), layout),
		"",
		truncateToWidth(`  ${summaryLine(report, layout)}`, layout.width),
	];

	if (report.findings.length === 0) {
		lines.push(
			"",
			truncateToWidth(
				`  ${style.fg("muted", `${report.counts.selected_rules} rules checked, nothing to fix.`)}`,
				layout.width,
			),
			rule(layout),
		);
		return lines;
	}

	const shown = layout.expanded
		? report.findings
		: report.findings.slice(0, COLLAPSED_FINDING_LIMIT);
	for (const finding of shown) {
		lines.push("", ...findingLines(finding, layout));
	}

	const hidden = report.findings.length - shown.length;
	if (hidden > 0) {
		const hint =
			layout.expandHint === undefined ? "" : `  ${layout.expandHint}`;
		lines.push(
			"",
			truncateToWidth(
				`  ${style.fg("dim", `… ${hidden} more finding${hidden === 1 ? "" : "s"}`)}${hint}`,
				layout.width,
			),
		);
	}

	if (report.warnings.length > 0) {
		lines.push(
			"",
			truncateToWidth(
				`  ${style.fg("dim", `${report.warnings.length} knowledge document${report.warnings.length === 1 ? "" : "s"} skipped`)}`,
				layout.width,
			),
		);
	}

	lines.push(rule(layout));
	return lines;
}
