import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	CancellableLoader,
	type Component,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { keyHint } from "./key-hint.js";
import type { ReviewProgress } from "./standards-review.js";

/** How wide the step progress bar is drawn, in columns. */
const BAR_WIDTH = 24;

/** Name one phase for the loader line. */
function phaseLabel(progress: ReviewProgress | undefined): string {
	if (progress === undefined) {
		return "Standards review";
	}
	switch (progress.phase) {
		case "resolving":
			return "Standards review · resolving rules";
		case "planning":
			return "Standards review · planning";
		case "evaluation":
			return "Standards review · evaluating";
		case "verification":
			return "Standards review · verifying";
	}
}

/** Draw a proportional bar of `completed` out of `total`. */
function bar(completed: number, total: number, theme: Theme): string {
	const filled = total <= 0 ? 0 : Math.round((completed / total) * BAR_WIDTH);
	return (
		theme.fg("success", "█".repeat(filled)) +
		theme.fg("dim", "░".repeat(Math.max(0, BAR_WIDTH - filled)))
	);
}

/** Format an elapsed duration as minutes and seconds. */
export function formatElapsed(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The panel shown while a review runs (specs/pi.md running a review).
 *
 * It answers what a reader waiting on a review wants to know: which phase runs,
 * how far it is, how long it has taken, and how to stop it. The loader animates
 * once per frame and asks the TUI to render, so the elapsed time advances
 * without a second timer.
 */
export class ReviewProgressPanel implements Component {
	private readonly loader: CancellableLoader;
	private readonly startedAt = Date.now();
	private progress: ReviewProgress | undefined;

	public constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
	) {
		this.loader = new CancellableLoader(
			tui,
			(text) => theme.fg("accent", text),
			(text) => theme.fg("muted", text),
			phaseLabel(undefined),
		);
	}

	/** Aborted when the reader cancels, so the review stops spending tokens. */
	public get signal(): AbortSignal {
		return this.loader.signal;
	}

	public set onAbort(handler: (() => void) | undefined) {
		this.loader.onAbort = handler;
	}

	/** Show one progress event. */
	public update(progress: ReviewProgress): void {
		this.progress = progress;
		this.loader.setMessage(phaseLabel(progress));
		this.tui.requestRender();
	}

	public handleInput(data: string): void {
		this.loader.handleInput(data);
	}

	public invalidate(): void {
		this.loader.invalidate();
	}

	public dispose(): void {
		this.loader.dispose();
	}

	public render(width: number): string[] {
		const border = this.theme.fg("border", "─".repeat(Math.max(1, width)));
		const elapsed = this.theme.fg(
			"dim",
			formatElapsed(Date.now() - this.startedAt),
		);
		const lines = [border, ...this.loader.render(width)];

		const progress = this.progress;
		if (progress !== undefined && "total" in progress) {
			lines.push(
				truncateToWidth(
					`  ${bar(progress.completed, progress.total, this.theme)} ` +
						`${this.theme.fg("muted", `${progress.completed}/${progress.total}`)} ${elapsed}`,
					width,
				),
			);
		} else {
			const detail = progress === undefined ? "" : `${progress.detail}  `;
			lines.push(
				truncateToWidth(`  ${this.theme.fg("dim", detail)}${elapsed}`, width),
			);
		}

		lines.push(
			truncateToWidth(
				`  ${keyHint(this.theme, "tui.select.cancel", "cancel")}`,
				width,
			),
			border,
		);
		return lines;
	}
}
