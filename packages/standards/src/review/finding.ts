/**
 * One rule violation that an evaluation agent reports (specs/review.md step 3).
 *
 * `lines` is the first and last line of the violation in the head revision, or
 * in the base revision for a deleted file. `evidence` is a short quote from the
 * change; `reason` connects the evidence to the rule.
 */
export interface Finding {
	rule: string;
	path: string;
	lines: [number, number];
	evidence: string;
	reason: string;
}
