import type { FileSelection } from "./rule-selection.js";

/**
 * One unit of evaluation work: the changed files and their selected rules that
 * one agent invocation reads (specs/review.md step 2).
 *
 * Tasks group by file, not by rule, so each hunk reaches a model once instead
 * of once per rule.
 */
export interface EvaluationTask {
	files: FileSelection[];
}

/**
 * Pack the rule selection into evaluation tasks (specs/review.md step 2).
 *
 * Each changed file appears in exactly one task together with all rules
 * selected for it. Version 1 places one file in each task; it defines no task
 * size budget, so it does not group several files into a shared task. Planning
 * is deterministic, so the same selection always produces the same tasks.
 */
export function planEvaluationTasks(
	selections: readonly FileSelection[],
): EvaluationTask[] {
	return selections.map((selection) => ({ files: [selection] }));
}
