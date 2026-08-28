import type { ReviewStepProgress } from "@getstandards/core";
import { chalkStderr } from "chalk";

/** The spinner frames, cycled while a review's agent steps run. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The delay between two spinner frames, in milliseconds. */
const SPINNER_INTERVAL_MS = 80;

/** The ANSI sequence that returns the cursor and erases the current line. */
const ERASE_LINE = "\r\x1B[K";

/** The subset of a terminal stream the spinner writes to. */
export interface SpinnerStream {
	write(chunk: string): void;
}

/**
 * An animated loading status on the last line of a terminal.
 *
 * The spinner shows that the review is working while the evaluation and
 * verification steps run. Only an interactive terminal shows it; captured
 * output stays free of animation.
 */
export interface ReviewSpinner {
	/** Show the spinner, or change its status text while it runs. */
	update(status: string): void;
	/** Write one full line above the spinner, keeping the spinner on the last line. */
	printLine(line: string): void;
	/** Stop the animation and erase the spinner line. */
	stop(): void;
}

/**
 * Create a spinner that animates a loading status on `stream`, which is
 * standard error: the review report on standard output stays clean. The
 * caller stops the spinner before the report is written, so the report never
 * shares a line with it.
 */
export function createReviewSpinner(stream: SpinnerStream): ReviewSpinner {
	let status = "";
	let frameIndex = 0;
	let interval: NodeJS.Timeout | undefined;
	let visible = false;

	const render = () => {
		const frame = chalkStderr.cyan(SPINNER_FRAMES[frameIndex] ?? "⠋");
		frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
		stream.write(`${ERASE_LINE}${frame} ${chalkStderr.dim(status)}`);
	};

	return {
		update: (nextStatus) => {
			status = nextStatus;
			visible = true;
			render();
			if (interval === undefined) {
				interval = setInterval(render, SPINNER_INTERVAL_MS);
				// A forgotten stop must not hold the process open.
				interval.unref();
			}
		},
		printLine: (line) => {
			stream.write(`${ERASE_LINE}${line}\n`);
			if (visible) {
				render();
			}
		},
		stop: () => {
			if (interval !== undefined) {
				clearInterval(interval);
				interval = undefined;
			}
			if (visible) {
				stream.write(ERASE_LINE);
				visible = false;
			}
		},
	};
}

/**
 * Render the live invocation count of one agent step as a status text, such
 * as 'Evaluating tasks 1/3'. The count names finished invocations.
 */
export function formatStepProgress(progress: ReviewStepProgress): string {
	return progress.step === "evaluation"
		? `Evaluating tasks ${progress.completed}/${progress.total}`
		: `Verifying findings ${progress.completed}/${progress.total}`;
}
