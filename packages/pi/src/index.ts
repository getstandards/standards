import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ReviewReport } from "@getstandards/core";
import {
	parseStandardsArgs,
	StandardsArgumentError,
	type StandardsCommandArgs,
} from "./command-args.js";
import { ReviewProgressPanel } from "./progress-panel.js";
import { createRegistryModels } from "./registry-models.js";
import {
	REVIEW_MESSAGE_TYPE,
	registerReportRenderer,
} from "./report-renderer.js";
import {
	formatFindingLine,
	formatFindingsMessage,
	formatReviewSummary,
} from "./review-message.js";
import {
	type ReviewHost,
	runStandardsReview,
	type StandardsReviewOutcome,
} from "./standards-review.js";

/**
 * Register `/standards`, which reviews a change from inside pi (specs/pi.md).
 *
 * The review runs in the pi process, so it uses pi's resolved authentication
 * and needs no `standards auth login`. A live panel shows the running phase,
 * a summary lands in the transcript, and the same message carries the findings
 * to the agent, so the agent can fix them.
 */
export default function standardsExtension(pi: ExtensionAPI): void {
	registerReportRenderer(pi);

	pi.registerCommand("standards", {
		description: "Review the change against the repository's standards",
		handler: async (args, ctx) => {
			let parsed: StandardsCommandArgs;
			try {
				parsed = parseStandardsArgs(args);
			} catch (error) {
				ctx.ui.notify(
					error instanceof StandardsArgumentError
						? error.diagnostic
						: String(error),
					"error",
				);
				return;
			}

			const outcome = await review(ctx, parsed);
			if (outcome === undefined) {
				ctx.ui.notify("Standards review cancelled.", "info");
				return;
			}
			if (outcome.kind === "diagnostic") {
				ctx.ui.notify(outcome.diagnostic, "error");
				return;
			}

			const report = outcome.report;
			deliverReviewReport(pi, report);

			// Outside the interactive transcript no renderer runs, so the summary
			// has to carry itself.
			if (ctx.mode !== "tui") {
				ctx.ui.notify(
					[
						formatReviewSummary(report),
						...report.findings.map(formatFindingLine),
					].join("\n"),
					report.conclusion === "compliant" ? "info" : "warning",
				);
			}
		},
	});
}

/**
 * Deliver one review report into the agent conversation (specs/pi.md reporting).
 *
 * The message displays through the registered renderer and enters the agent's
 * context without starting a turn: the user decides when to ask for the fixes.
 * It uses pi's default delivery. Deliveries that queue the message, like
 * `deliverAs: "nextTurn"`, hold the report back until the next user prompt and
 * never render it in the transcript, so a finished review would print nothing.
 */
export function deliverReviewReport(
	pi: Pick<ExtensionAPI, "sendMessage">,
	report: ReviewReport,
): void {
	pi.sendMessage({
		customType: REVIEW_MESSAGE_TYPE,
		content: formatFindingsMessage(report),
		display: true,
		details: report,
	});
}

/**
 * Run the review with pi's model registry and a live progress panel.
 *
 * In interactive mode the panel shows the running phase and lets the user
 * cancel, which aborts the review; it returns undefined when the user does. In
 * every other mode the review runs without a panel, because there is no
 * terminal to draw it in or to press a key in.
 */
async function review(
	ctx: ExtensionCommandContext,
	args: StandardsCommandArgs,
): Promise<StandardsReviewOutcome | undefined> {
	const host: ReviewHost = {
		cwd: ctx.cwd,
		models: createRegistryModels(ctx.modelRegistry),
		activeModel:
			ctx.model === undefined
				? undefined
				: `${ctx.model.provider}/${ctx.model.id}`,
		environment: process.env,
	};

	if (ctx.mode !== "tui") {
		return runStandardsReview(host, args);
	}

	return ctx.ui.custom<StandardsReviewOutcome | undefined>(
		(tui, theme, _keybindings, done) => {
			const panel = new ReviewProgressPanel(tui, theme);
			panel.onAbort = () => done(undefined);
			runStandardsReview(
				{
					...host,
					signal: panel.signal,
					reportProgress: (progress) => panel.update(progress),
				},
				args,
			)
				.then(done)
				.catch((error: unknown) =>
					done({
						kind: "diagnostic",
						diagnostic: error instanceof Error ? error.message : String(error),
					}),
				);
			return panel;
		},
	);
}
