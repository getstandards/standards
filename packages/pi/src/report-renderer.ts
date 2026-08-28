import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getLanguageFromPath,
	highlightCode,
} from "@earendil-works/pi-coding-agent";
import type { ReviewReport } from "@getstandards/core";
import { keyHint } from "./key-hint.js";
import { formatReportLines } from "./report-lines.js";

/** The custom message type that carries one review report in the session. */
export const REVIEW_MESSAGE_TYPE = "standards-review";

/**
 * Draw a review report in the pi transcript (specs/pi.md reporting).
 *
 * One message serves both readers: its `content` is the text the agent reads,
 * and its `details` is the typed report this renderer draws for the person.
 * The renderer runs again on a theme change and on an expand toggle, so it
 * computes its colors on every call instead of caching a styled string.
 */
export function registerReportRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<ReviewReport>(
		REVIEW_MESSAGE_TYPE,
		(message, { expanded }, theme) => {
			const report = message.details;
			if (report === undefined) {
				return undefined;
			}
			return {
				invalidate() {},
				render(width: number) {
					return formatReportLines(report, {
						style: theme,
						width,
						expanded,
						expandHint: keyHint(theme, "app.tools.expand", "to expand"),
						highlight: (code, path) =>
							highlightCode(code, getLanguageFromPath(path)),
					});
				},
			};
		},
	);
}
