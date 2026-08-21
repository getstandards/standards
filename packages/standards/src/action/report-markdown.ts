import { createHash } from "node:crypto";
import type { Rule } from "../config/index.js";
import type { StepUsage } from "../review/agent-usage.js";
import type { ReportedFinding, ReviewReport } from "../review/review-report.js";

/**
 * The hidden marker that identifies the summary comment (specs/github.md).
 * It is the comment's first line; the action finds the comment by it.
 */
export const REPORT_COMMENT_MARKER = "<!-- standards:report:v1 -->";

/**
 * The marker pattern that identifies a finding comment and captures its
 * fingerprint (specs/github.md finding comments).
 */
export const FINDING_MARKER_PATTERN =
	/<!-- standards:finding:v1:([0-9a-f]{16}) -->/;

/**
 * The fingerprint that identifies a finding across runs (specs/github.md).
 *
 * The `lines` are not part of it, so a push that only moves a finding does
 * not repost its comment.
 */
export function findingFingerprint(finding: ReportedFinding): string {
	return createHash("sha256")
		.update(`${finding.rule}\n${finding.path}\n${finding.evidence}`)
		.digest("hex")
		.slice(0, 16);
}

/** The hidden marker on a finding comment's first line (specs/github.md). */
function findingCommentMarker(finding: ReportedFinding): string {
	return `<!-- standards:finding:v1:${findingFingerprint(finding)} -->`;
}

/**
 * The most evidence lines one finding may quote in the comment.
 *
 * Evidence is untrusted change content; specs/github.md relies on a quote
 * length bound for what a manipulated change can display, and the pipeline
 * enforces none, so the renderer truncates here.
 */
const EVIDENCE_LINE_LIMIT = 10;

/** The most evidence characters one finding may quote in the comment. */
const EVIDENCE_CHARACTER_LIMIT = 1000;

/** The largest text a check run summary or a comment body accepts. */
const SURFACE_CHARACTER_LIMIT = 65_535;

/** The links a rendered report needs (specs/github.md comment layout). */
export interface ReportRenderContext {
	/** The repository web URL, such as `https://github.com/acme/shop`. */
	repositoryUrl: string;
	headSha: string;
	mergeBaseSha: string;
}

/** A finding's requirement level blocks the merge (specs/github.md). */
function isBlockingLevel(level: Rule["level"]): boolean {
	return level === "MUST" || level === "MUST NOT";
}

/** The level emoji used by the comment tables and headings. */
function levelEmoji(level: Rule["level"]): string {
	return isBlockingLevel(level) ? "🛑" : "⚠️";
}

/** Format a count with thousands separators, such as `47,150`. */
function formatCount(count: number): string {
	return count.toLocaleString("en-US");
}

/** The first seven characters of a commit SHA, for link text. */
function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

/** A file's web URL at the head commit, so the link survives later pushes. */
function blobUrl(
	context: ReportRenderContext,
	path: string,
	lines: [number, number],
): string {
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	const fragment =
		lines[0] === lines[1] ? `#L${lines[0]}` : `#L${lines[0]}-L${lines[1]}`;
	return `${context.repositoryUrl}/blob/${context.headSha}/${encodedPath}${fragment}`;
}

/** A finding's location as `path:8` or `path:41-44`. */
function locationText(path: string, lines: [number, number]): string {
	return lines[0] === lines[1]
		? `${path}:${lines[0]}`
		: `${path}:${lines[0]}-${lines[1]}`;
}

/** A finding's location as a link for a table cell. */
function locationLink(
	context: ReportRenderContext,
	path: string,
	lines: [number, number],
): string {
	return `[\`${locationText(path, lines)}\`](${blobUrl(context, path, lines)})`;
}

/** A finding's location as a linked sentence, such as `lines 41–44`. */
function locationSentence(
	context: ReportRenderContext,
	finding: ReportedFinding,
): string {
	const lineText =
		finding.lines[0] === finding.lines[1]
			? `line ${finding.lines[0]}`
			: `lines ${finding.lines[0]}–${finding.lines[1]}`;
	return `📄 [\`${finding.path}\`, ${lineText}](${blobUrl(context, finding.path, finding.lines)})`;
}

/** Escape a value for one Markdown table cell. */
function tableCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();
}

/** A code fence long enough that the content cannot close it. */
function codeFence(content: string): string {
	const longestRun = content
		.match(/`{3,}/g)
		?.reduce((longest, run) => Math.max(longest, run.length), 0);
	return "`".repeat(Math.max(3, (longestRun ?? 0) + 1));
}

/** Truncate an evidence quote to the renderer's length bound. */
function truncateEvidence(evidence: string): string {
	let quote = evidence;
	let truncated = false;
	if (quote.length > EVIDENCE_CHARACTER_LIMIT) {
		quote = quote.slice(0, EVIDENCE_CHARACTER_LIMIT);
		truncated = true;
	}
	const lines = quote.split("\n");
	if (lines.length > EVIDENCE_LINE_LIMIT) {
		quote = lines.slice(0, EVIDENCE_LINE_LIMIT).join("\n");
		truncated = true;
	}
	return truncated ? `${quote}\n…` : quote;
}

/** Render an evidence quote as added lines in a `diff` code block. */
function evidenceBlock(evidence: string): string {
	const quote = truncateEvidence(evidence);
	const body = quote
		.split("\n")
		.map((line) => `+ ${line}`)
		.join("\n");
	const fence = codeFence(quote);
	return `${fence}diff\n${body}\n${fence}`;
}

/** Render a rule's guidance and references as a quoted fix block. */
function fixBlock(
	context: ReportRenderContext,
	finding: ReportedFinding,
): string[] {
	const lines: string[] = [];
	if (finding.guidance !== undefined) {
		lines.push(`> 💡 **How to fix:** ${finding.guidance}`);
	}
	for (const reference of finding.references ?? []) {
		lines.push(`> 📚 ${referenceLink(context, reference)}`);
	}
	return lines.length > 0 ? [lines.join("\n")] : [];
}

/** Render one rule reference as a link: a URL, or a repository path. */
function referenceLink(
	context: ReportRenderContext,
	reference: string,
): string {
	if (/^https?:\/\//.test(reference)) {
		const text = reference.replace(/^https?:\/\//, "");
		return `[${text}](${reference})`;
	}
	const encodedPath = reference.split("/").map(encodeURIComponent).join("/");
	return `[\`${reference}\`](${context.repositoryUrl}/blob/${context.headSha}/${encodedPath})`;
}

/** Render one expanded finding, as the blocking section shows it. */
function expandedFinding(
	context: ReportRenderContext,
	finding: ReportedFinding,
	number: number,
): string[] {
	return [
		`#### ${number}. \`${finding.rule}\` — ${finding.level}`,
		locationSentence(context, finding),
		evidenceBlock(finding.evidence),
		finding.reason,
		...fixBlock(context, finding),
	];
}

/** Render one collapsed finding, as the warnings section shows it. */
function collapsedFinding(
	context: ReportRenderContext,
	finding: ReportedFinding,
	number: number,
): string[] {
	return [
		"<details>",
		`<summary><b>${number}.</b> <code>${finding.rule}</code> — ${finding.level} · <code>${locationText(finding.path, finding.lines)}</code></summary>`,
		"",
		locationSentence(context, finding),
		"",
		evidenceBlock(finding.evidence),
		"",
		finding.reason,
		...fixBlock(context, finding).flatMap((block) => ["", block]),
		"",
		"</details>",
	];
}

/** Join count phrases into one sentence part: `1 warning and 2 findings`. */
function joinPhrases(phrases: string[]): string {
	if (phrases.length <= 1) {
		return phrases[0] ?? "";
	}
	return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

/** A count with its singular or plural noun, such as `2 warnings`. */
function countPhrase(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/** Render the alert callout with the merge verdict and the finding counts. */
function verdictCallout(report: ReviewReport, noteComments = false): string {
	const blocking = report.findings.filter((finding) =>
		isBlockingLevel(finding.level),
	).length;
	const warnings = report.findings.length - blocking;
	const listed: { count: number; phrase: string }[] = [];
	if (warnings > 0) {
		listed.push({
			count: warnings,
			phrase: countPhrase(warnings, "warning", "warnings"),
		});
	}
	if (report.suppressed.length > 0) {
		listed.push({
			count: report.suppressed.length,
			phrase: countPhrase(
				report.suppressed.length,
				"suppressed finding",
				"suppressed findings",
			),
		});
	}
	const verb = listed.length === 1 && listed[0]?.count === 1 ? "is" : "are";
	const listedSentence =
		listed.length === 0
			? ""
			: ` ${joinPhrases(listed.map((entry) => entry.phrase))} ${verb} listed below.`;
	const commentsNote =
		noteComments && report.findings.length > 0
			? " Each confirmed finding has a review comment on its lines."
			: "";

	if (blocking > 0) {
		const findingPhrase = countPhrase(
			blocking,
			"blocking finding",
			"blocking findings",
		);
		return `> [!CAUTION]\n> **${findingPhrase}** must be resolved or suppressed with a reason before this pull request can merge.${listedSentence}${commentsNote}`;
	}
	return `> [!NOTE]\n> **No blocking findings.** This pull request can merge.${listedSentence}${commentsNote}`;
}

/** Render the overview table shown when more than one finding exists. */
function overviewTable(
	context: ReportRenderContext,
	findings: readonly ReportedFinding[],
): string {
	const rows = findings.map(
		(finding, index) =>
			`| ${index + 1} | \`${finding.rule}\` | ${levelEmoji(finding.level)} ${finding.level} | ${locationLink(context, finding.path, finding.lines)} |`,
	);
	return [
		"| # | Rule | Level | Location |",
		"| --- | --- | --- | --- |",
		...rows,
	].join("\n");
}

/** Render the suppressed findings table and the invalid marker callout. */
function suppressedSection(
	context: ReportRenderContext,
	report: ReviewReport,
): string[] {
	const sections: string[] = [];
	if (report.suppressed.length > 0) {
		const rows = report.suppressed.map(
			(finding) =>
				`| \`${finding.rule}\` | ${finding.level} | ${locationLink(context, finding.path, finding.lines)} | ${tableCell(finding.suppression_reason)} |`,
		);
		sections.push(
			"### 🔇 Suppressed",
			"> [!NOTE]\n> Suppressed findings were not verified and do not change the conclusion.\n> The marker and its reason are part of this change — review them like code.",
			[
				"| Rule | Level | Location | Author's reason |",
				"| --- | --- | --- | --- |",
				...rows,
			].join("\n"),
		);
	}
	if (report.invalid_suppressions.length > 0) {
		const markerPhrase = countPhrase(
			report.invalid_suppressions.length,
			"invalid suppression marker has",
			"invalid suppression markers have",
		);
		const lines = report.invalid_suppressions.map(
			(marker) =>
				`> ${locationLink(context, marker.path, [marker.line, marker.line])} — ${marker.reason}`,
		);
		sections.push(
			`> [!WARNING]\n> **${markerPhrase}** no effect:\n${lines.join("\n")}`,
		);
	}
	return sections;
}

/** Render one agent step row of the review details table. */
function usageRow(step: string, model: string, usage: StepUsage): string {
	return `| ${step} | \`${model}\` | ${formatCount(usage.invocations)} | ${formatCount(usage.input_tokens)} | ${formatCount(usage.output_tokens)} |`;
}

/** Render the collapsed review details block with counts and usage. */
function detailsSection(report: ReviewReport): string {
	const blocking = report.findings.filter((finding) =>
		isBlockingLevel(finding.level),
	).length;
	const warnings = report.findings.length - blocking;
	const totalTokens =
		report.usage.evaluation.input_tokens +
		report.usage.evaluation.output_tokens +
		report.usage.verification.input_tokens +
		report.usage.verification.output_tokens;
	return [
		"<details>",
		`<summary>📊 <b>Review details</b> — ${formatCount(report.counts.resolved_rules)} rules resolved · ${formatCount(report.counts.selected_rules)} selected · ${formatCount(report.counts.evaluation_tasks)} evaluation tasks · ${formatCount(totalTokens)} tokens</summary>`,
		"",
		[
			"| Findings | Count |",
			"| --- | ---: |",
			`| 🛑 MUST / MUST NOT | ${blocking} |`,
			`| ⚠️ SHOULD / SHOULD NOT | ${warnings} |`,
			`| 🔇 Suppressed | ${report.suppressed.length} |`,
		].join("\n"),
		"",
		[
			"| Agent step | Model | Invocations | Input tokens | Output tokens |",
			"| --- | --- | ---: | ---: | ---: |",
			usageRow("Evaluation", report.models.evaluation, report.usage.evaluation),
			usageRow(
				"Verification",
				report.models.verification,
				report.usage.verification,
			),
		].join("\n"),
		"",
		"Every finding above was confirmed by an independent verification pass.",
		"Rejected findings are not shown.",
		"",
		"</details>",
	].join("\n");
}

/** Render the footer that names the reviewed commits. */
function footer(context: ReportRenderContext): string {
	return `---\n🔍 Reviewed [\`${shortSha(context.headSha)}\`](${context.repositoryUrl}/commit/${context.headSha}) against merge base [\`${shortSha(context.mergeBaseSha)}\`](${context.repositoryUrl}/commit/${context.mergeBaseSha}) · [What is Standards?](https://github.com/getstandards/standards)`;
}

/**
 * Render the report as the check run body (specs/github.md run behavior).
 *
 * The check run is a standalone surface without nearby finding comments, so
 * it keeps every finding expanded. Sections with no entries do not render.
 */
function renderReportBody(
	report: ReviewReport,
	context: ReportRenderContext,
): string {
	const compliant = report.conclusion === "compliant";
	const heading = compliant
		? "## ✅ Standards review — Compliant"
		: "## 🛑 Standards review — Non-compliant";

	// Blocking findings come first, so numbering follows the display order.
	const blocking = report.findings.filter((finding) =>
		isBlockingLevel(finding.level),
	);
	const warnings = report.findings.filter(
		(finding) => !isBlockingLevel(finding.level),
	);
	const numbered = [...blocking, ...warnings];

	const sections: string[] = [heading, verdictCallout(report)];
	if (numbered.length > 1) {
		sections.push(overviewTable(context, numbered));
	}
	if (blocking.length > 0) {
		sections.push(
			"### 🛑 Blocking findings",
			...blocking.flatMap((finding, index) =>
				expandedFinding(context, finding, index + 1),
			),
		);
	}
	if (warnings.length > 0) {
		sections.push(
			"### ⚠️ Warnings",
			"Warnings do not block the merge by themselves.",
			...warnings.map((finding, index) =>
				collapsedFinding(context, finding, blocking.length + index + 1).join(
					"\n",
				),
			),
		);
	}
	sections.push(
		...suppressedSection(context, report),
		detailsSection(report),
		footer(context),
	);
	return sections.join("\n\n");
}

/** Clamp a rendered surface to the size the GitHub API accepts. */
function clampSurface(body: string): string {
	if (body.length <= SURFACE_CHARACTER_LIMIT) {
		return body;
	}
	const notice = "\n\n… (truncated)";
	return body.slice(0, SURFACE_CHARACTER_LIMIT - notice.length) + notice;
}

/**
 * Render the summary comment for one review report (specs/github.md comment
 * layout).
 *
 * The comment is the index of the review: the per-finding detail lives in
 * the finding comments, so it repeats no finding beyond one overview row.
 * `unanchored` names the findings without a finding comment — locations the
 * pull request diff rejected — and only those render expanded here.
 */
export function renderSummaryComment(
	report: ReviewReport,
	context: ReportRenderContext,
	unanchored: readonly ReportedFinding[] = [],
): string {
	const compliant = report.conclusion === "compliant";
	const heading = compliant
		? "## ✅ Standards review — Compliant"
		: "## 🛑 Standards review — Non-compliant";

	// Blocking findings come first, so numbering follows the display order.
	const blocking = report.findings.filter((finding) =>
		isBlockingLevel(finding.level),
	);
	const warnings = report.findings.filter(
		(finding) => !isBlockingLevel(finding.level),
	);
	const numbered = [...blocking, ...warnings];
	const unanchoredSet = new Set(unanchored);
	const expanded = numbered.filter((finding) => unanchoredSet.has(finding));

	const sections: string[] = [
		REPORT_COMMENT_MARKER,
		heading,
		verdictCallout(report, expanded.length === 0),
	];
	if (numbered.length > 0) {
		sections.push(overviewTable(context, numbered));
	}
	if (expanded.length > 0) {
		sections.push(
			"### Findings without a review comment",
			"These findings could not be anchored to the pull request diff.",
			...expanded.flatMap((finding) =>
				expandedFinding(context, finding, numbered.indexOf(finding) + 1),
			),
		);
	}
	sections.push(
		...suppressedSection(context, report),
		detailsSection(report),
		footer(context),
	);
	// The marker joins with a line break so it stays the first line.
	const [marker, ...body] = sections;
	return clampSurface(`${marker}\n${body.join("\n\n")}`);
}

/**
 * Render one finding comment body (specs/github.md finding comments).
 *
 * The comment is short prose under the annotated lines: a severity emoji
 * and the reason in bold, the guidance and references as plain lines, and
 * a footer with the level and the rule id. It quotes no evidence — the
 * annotated lines sit directly above it.
 */
export function renderFindingComment(
	finding: ReportedFinding,
	context: ReportRenderContext,
): string {
	const emoji = isBlockingLevel(finding.level) ? "🛑" : "🟡";
	const advice: string[] = [];
	if (finding.guidance !== undefined) {
		advice.push(`💡 ${finding.guidance}`);
	}
	for (const reference of finding.references ?? []) {
		advice.push(`📚 ${referenceLink(context, reference)}`);
	}
	const sections = [
		`${emoji} **${finding.reason}**`,
		...(advice.length > 0 ? [advice.join("\n")] : []),
		`<sub>${finding.level} · \`${finding.rule}\` · Standards review</sub>`,
	];
	return clampSurface(
		`${findingCommentMarker(finding)}\n${sections.join("\n\n")}`,
	);
}

/** Render the check run summary for one review report (specs/github.md). */
export function renderCheckRunSummary(
	report: ReviewReport,
	context: ReportRenderContext,
): string {
	return clampSurface(renderReportBody(report, context));
}

/** The links a rendered failure needs; a failure has no merge base. */
export interface FailureRenderContext {
	repositoryUrl: string;
	headSha: string;
}

/** Render the summary comment for a review that failed (specs/github.md). */
export function renderFailureComment(
	diagnostic: string,
	context: FailureRenderContext,
): string {
	const fence = codeFence(diagnostic);
	return clampSurface(
		[
			REPORT_COMMENT_MARKER,
			"## 🛑 Standards review — Failed",
			"> [!CAUTION]\n> The review failed and reports no conclusion.",
			`${fence}\n${diagnostic}\n${fence}`,
			`---\n🔍 Reviewed [\`${shortSha(context.headSha)}\`](${context.repositoryUrl}/commit/${context.headSha}) · [What is Standards?](https://github.com/getstandards/standards)`,
		].join("\n\n"),
	);
}
