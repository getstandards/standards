import type { AgentStep } from "./model-selection.js";

/**
 * The live progress of one agent step (specs/review.md steps 3 and 4).
 *
 * `completed` counts the invocations that finished; `total` is the number of
 * invocations the step runs. An interactive surface renders this as a loading
 * status while the step runs, so the user sees that the review is working.
 */
export interface ReviewStepProgress {
	step: AgentStep;
	completed: number;
	total: number;
}

/**
 * Start the progress reporting of one agent step: report zero finished
 * invocations now, then one more on each call of the returned function.
 * Reports nothing when `report` is undefined or the step has no invocations.
 */
export function startStepProgress(
	step: AgentStep,
	total: number,
	report: ((progress: ReviewStepProgress) => void) | undefined,
): () => void {
	if (report === undefined || total === 0) {
		return () => {};
	}

	let completed = 0;
	report({ step, completed, total });
	return () => {
		completed += 1;
		report({ step, completed, total });
	};
}
