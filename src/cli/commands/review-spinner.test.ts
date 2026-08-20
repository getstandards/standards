import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewSpinner, formatStepProgress } from "./review-spinner.js";

/** Remove ANSI escape codes so assertions stay independent of the terminal. */
function stripAnsi(text: string): string {
	const ansiEscape = "\x1B";
	return text.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
}

/** A stream that collects the chunks the spinner writes. */
function fakeStream() {
	const chunks: string[] = [];
	return {
		chunks,
		write: (chunk: string) => chunks.push(chunk),
	};
}

// chalkStderr renders plain text when standard error is not a terminal, so
// the tests assert frames and status text after stripping escape codes.
describe("createReviewSpinner", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("animates the status text while it runs", () => {
		const stream = fakeStream();
		const spinner = createReviewSpinner(stream);

		spinner.update("Evaluating tasks 0/2");
		vi.advanceTimersByTime(160);

		const frames = stream.chunks.map(stripAnsi);
		expect(frames[0]).toBe("\r\x1B[K⠋ Evaluating tasks 0/2");
		expect(frames[1]).toBe("\r\x1B[K⠙ Evaluating tasks 0/2");
		expect(frames[2]).toBe("\r\x1B[K⠹ Evaluating tasks 0/2");
	});

	it("changes the status text on update", () => {
		const stream = fakeStream();
		const spinner = createReviewSpinner(stream);

		spinner.update("Evaluating tasks 0/2");
		spinner.update("Verifying findings 0/1");

		const last = stripAnsi(stream.chunks.at(-1) ?? "");
		expect(last).toBe("\r\x1B[K⠙ Verifying findings 0/1");
	});

	it("stops the animation and erases the line", () => {
		const stream = fakeStream();
		const spinner = createReviewSpinner(stream);

		spinner.update("Evaluating tasks 0/2");
		vi.advanceTimersByTime(80);
		spinner.stop();
		const chunksAtStop = stream.chunks.length;
		vi.advanceTimersByTime(240);

		expect(stripAnsi(stream.chunks[chunksAtStop - 1] ?? "")).toBe("\r\x1B[K");
		expect(stream.chunks.length).toBe(chunksAtStop);
	});

	it("writes a full line above the spinner", () => {
		const stream = fakeStream();
		const spinner = createReviewSpinner(stream);

		spinner.update("Evaluating tasks 1/2");
		spinner.printLine("Evaluating 2 selected files in 2 evaluation tasks.");

		const printed = stream.chunks.map(stripAnsi);
		expect(printed[1]).toBe(
			"\r\x1B[KEvaluating 2 selected files in 2 evaluation tasks.\n",
		);
		// The spinner redraws below the printed line.
		expect(printed[2]).toBe("\r\x1B[K⠙ Evaluating tasks 1/2");
	});
});

describe("formatStepProgress", () => {
	it("renders the count of finished invocations of each step", () => {
		expect(
			formatStepProgress({ step: "evaluation", completed: 1, total: 3 }),
		).toBe("Evaluating tasks 1/3");
		expect(
			formatStepProgress({ step: "verification", completed: 2, total: 5 }),
		).toBe("Verifying findings 2/5");
	});
});
