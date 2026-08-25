import { createHash } from "node:crypto";
import type { Rule } from "../config/index.js";
import { formatCost, type StepUsage } from "../review/agent-usage.js";
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
 * The fingerprint that identifies a finding when GitHub can no longer map
 * its comment to the current diff (specs/github.md finding comments).
 *
 * It is the first sixteen characters of the lowercase hexadecimal SHA-256
 * digest of the rule `id`, the `path`, and the source anchor, joined with a
 * newline. The line numbers are not part of the digest, so a push that only
 * moves an unchanged source anchor within the same path does not change the
 * fingerprint. It never contains model output: the `evidence`, the `reason`,
 * and the `suggested_change` MUST NOT affect finding identity.
 */
export function findingFingerprint(
	rule: string,
	path: string,
	anchor: string,
): string {
	return createHash("sha256")
		.update(`${rule}\n${path}\n${anchor}`)
		.digest("hex")
		.slice(0, 16);
}

/**
 * The source anchor of one finding (specs/github.md finding comments).
 *
 * The anchor is the exact text from the first through the last finding line
 * in the finding revision — the head revision, or the base revision for a
 * deleted file. Line separators are represented as `\n`, and a final line
 * break is omitted, so the digest input carries no closing newline.
 */
export function findingSourceAnchor(
	content: string,
	lines: [number, number],
): string {
	return content
		.split("\n")
		.slice(lines[0] - 1, lines[1])
		.join("\n");
}

/** The hidden marker on a finding comment's first line (specs/github.md). */
function findingCommentMarker(
	finding: ReportedFinding,
	anchor: string,
): string {
	return `<!-- standards:finding:v1:${findingFingerprint(finding.rule, finding.path, anchor)} -->`;
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

/**
 * Render a suggested change as a GitHub `suggestion` code block.
 *
 * The annotated lines sit directly above the comment, so GitHub can apply the
 * replacement when an authorized user chooses to (specs/github.md finding
 * comments). The fence is long enough that the replacement cannot close it,
 * and the replacement is put in verbatim.
 */
function suggestionBlock(replacement: string): string {
	const fence = codeFence(replacement);
	return `${fence}suggestion\n${replacement}\n${fence}`;
}

/**
 * Render a suggested change as a labeled plain code block.
 *
 * The summary surfaces use this instead of GitHub's `suggestion` type: the
 * block is not attached to an applicable diff range there
 * (specs/github.md comment layout).
 */
function replacementBlock(replacement: string): string {
	const fence = codeFence(replacement);
	return `Suggested change:\n${fence}\n${replacement}\n${fence}`;
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
		...(finding.suggested_change !== undefined
			? [replacementBlock(finding.suggested_change)]
			: []),
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
		...(finding.suggested_change !== undefined
			? ["", replacementBlock(finding.suggested_change)]
			: []),
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
	return `| ${step} | \`${model}\` | ${formatCount(usage.invocations)} | ${formatCount(usage.input_tokens)} | ${formatCount(usage.output_tokens)} | ${formatCost(usage.cost)} |`;
}

/** The note under the usage table when the cost is not a charge. */
function costBasisNote(report: ReviewReport): string[] {
	switch (report.usage.cost_basis) {
		case "charged":
			return [];
		case "list_price_estimate":
			return ["The cost is a list price estimate, not a charge."];
		case "none":
			return ["The models have no per-token price."];
	}
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
			"| Agent step | Model | Invocations | Input tokens | Output tokens | Cost |",
			"| --- | --- | ---: | ---: | ---: | ---: |",
			usageRow("Evaluation", report.models.evaluation, report.usage.evaluation),
			usageRow(
				"Verification",
				report.models.verification,
				report.usage.verification,
			),
			`| Total | | | | | ${formatCost(report.usage.total_cost)} |`,
		].join("\n"),
		...costBasisNote(report).flatMap((note) => ["", note]),
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

/**
 * Clamp a rendered surface to the size the GitHub API accepts.
 *
 * A cut that would land inside a fenced code block moves before the block,
 * so the result never exceeds the limit and a suggested change replacement
 * is shown complete or omitted entirely, never truncated
 * (specs/github.md comment layout).
 */
function clampSurface(body: string): string {
	if (body.length <= SURFACE_CHARACTER_LIMIT) {
		return body;
	}
	const notice = "\n\n… (truncated)";
	const limit = SURFACE_CHARACTER_LIMIT - notice.length;
	const blockStart = fencedBlockStart(body, limit);
	const text = body.slice(0, blockStart ?? limit).trimEnd();
	return `${text}${notice}`;
}

/** The width of a line's opening or closing fence, when it starts one. */
function fenceWidth(line: string): number | undefined {
	const match = /^[ \t]*(`{3,})/.exec(line);
	if (match === null) {
		return undefined;
	}
	return match[1]?.length;
}

/**
 * The start offset of the fenced block whose lines contain `position`, or
 * undefined when that position is outside every fenced block.
 *
 * A closing fence counts when its backtick run is at least as long as the
 * opening run. The opening and closing fence lines belong to the block, and
 * a block left open runs to the end of the body.
 */
function fencedBlockStart(body: string, position: number): number | undefined {
	let offset = 0;
	let blockStart: number | undefined;
	let openingFence: number | undefined;
	for (const line of body.split("\n")) {
		const lineEnd = offset + line.length + 1;
		const width = fenceWidth(line);
		const closes =
			openingFence !== undefined &&
			width !== undefined &&
			width >= openingFence;
		if (openingFence === undefined && width !== undefined) {
			openingFence = width;
			blockStart = offset;
		}
		if (position < lineEnd) {
			return blockStart;
		}
		if (closes) {
			openingFence = undefined;
			blockStart = undefined;
		}
		offset = lineEnd;
	}
	return blockStart;
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
 * and the reason in bold, a GitHub `suggestion` block when the finding has
 * an applicable suggested change, the guidance and references as plain
 * lines, and a footer with the level and the rule id. It quotes no evidence
 * — the annotated lines sit directly above it. `anchor` is the finding's
 * source anchor, which the marker's fingerprint is computed from.
 * `includeSuggestion` is false for the retry after GitHub rejects a
 * suggestion-bearing comment.
 *
 * A suggested change is applicable only when the complete comment fits the
 * surface limit; when it does not, the action omits the suggestion block
 * and posts the plain comment instead.
 */
export function renderFindingComment(
	finding: ReportedFinding,
	context: ReportRenderContext,
	anchor: string,
	includeSuggestion = true,
): string {
	const withSuggestion =
		includeSuggestion && finding.suggested_change !== undefined
			? renderFindingCommentBody(finding, context, anchor, true)
			: undefined;
	const body =
		withSuggestion !== undefined &&
		withSuggestion.length <= SURFACE_CHARACTER_LIMIT
			? withSuggestion
			: renderFindingCommentBody(finding, context, anchor, false);
	return clampSurface(body);
}

/** Render the complete finding comment for one include-suggestion choice. */
function renderFindingCommentBody(
	finding: ReportedFinding,
	context: ReportRenderContext,
	anchor: string,
	includeSuggestion: boolean,
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
		...(includeSuggestion && finding.suggested_change !== undefined
			? [suggestionBlock(finding.suggested_change)]
			: []),
		...(advice.length > 0 ? [advice.join("\n")] : []),
		`<sub>${finding.level} · \`${finding.rule}\` · Standards review</sub>`,
	];
	// The marker joins with a line break so it stays the first line.
	return `${findingCommentMarker(finding, anchor)}\n${sections.join("\n\n")}`;
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
