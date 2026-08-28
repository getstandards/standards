import {
	formatCost,
	type ReportedFinding,
	type ReviewReport,
} from "@getstandards/core";

/** The blocking and advisory finding counts of one report. */
export function countFindings(report: ReviewReport): {
	blocking: number;
	warning: number;
} {
	let blocking = 0;
	let warning = 0;
	for (const finding of report.findings) {
		if (finding.level === "MUST") {
			blocking += 1;
		} else {
			warning += 1;
		}
	}
	return { blocking, warning };
}

/**
 * Render the review summary: the conclusion, the counts, and the cost.
 *
 * `list_price_estimate` means a subscription credential paid the tokens, so the
 * number is what the API would have charged, not a charge.
 */
export function formatReviewSummary(report: ReviewReport): string {
	const { blocking, warning } = countFindings(report);
	let cost = "";
	if (report.usage.cost_basis === "list_price_estimate") {
		cost = `, about ${formatCost(report.usage.total_cost)}`;
	} else if (report.usage.cost_basis === "charged") {
		cost = `, ${formatCost(report.usage.total_cost)}`;
	}
	return (
		`Standards review: ${report.conclusion}. ` +
		`${blocking} blocking, ${warning} warning` +
		`${warning === 1 ? "" : "s"}${cost}.`
	);
}

/** Render one finding as the summary line: rule id, path, and lines. */
export function formatFindingLine(finding: ReportedFinding): string {
	const [first, last] = finding.lines;
	const lines = first === last ? `${first}` : `${first}-${last}`;
	const marker = finding.level === "MUST" ? "blocking" : "warning";
	return `${marker} ${finding.rule} ${finding.path}:${lines}`;
}

/** Render one finding with everything an agent needs to fix it. */
function formatFindingDetail(finding: ReportedFinding): string {
	const [first, last] = finding.lines;
	const parts = [
		`### ${finding.rule} (${finding.level})`,
		`${finding.path}:${first}-${last}`,
		`Rule: ${finding.title}`,
		`Problem: ${finding.reason}`,
		`Evidence:\n\n\`\`\`\n${finding.evidence}\n\`\`\``,
	];
	if (finding.suggestion !== undefined) {
		parts.push(`Suggestion: ${finding.suggestion}`);
	}
	if (finding.suggested_change !== undefined) {
		parts.push(
			`Suggested change for lines ${first}-${last}:\n\n` +
				`\`\`\`\n${finding.suggested_change}\n\`\`\``,
		);
	}
	return parts.join("\n\n");
}

/**
 * Render the one message the extension delivers into the agent conversation.
 *
 * It carries the summary and every finding with its path, lines, evidence,
 * reason, and suggested change, so the agent can fix the findings and the user
 * can run `/standards` again. A compliant review with no findings still
 * reports, so the agent knows the review ran.
 */
export function formatFindingsMessage(report: ReviewReport): string {
	const header = `## ${formatReviewSummary(report)}`;
	if (report.findings.length === 0) {
		return `${header}\n\nNo findings. Do not change the code for this review.`;
	}
	return [
		header,
		"Fix the findings below. Each one names the rule it violates, the file " +
			"and lines it covers, and why the change violates the rule.",
		...report.findings.map(formatFindingDetail),
	].join("\n\n");
}
