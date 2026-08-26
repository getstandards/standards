/**
 * One rule violation that an evaluation agent reports (specs/review.md step 3).
 *
 * `lines` is the first and last line of the violation in the head revision, or
 * in the base revision for a deleted file. `evidence` is a short quote from the
 * change; `reason` connects the evidence to the rule. `suggestion` is the
 * agent's remediation advice, specific to this change. `suggestedChange` is the
 * candidate exact replacement for `lines` that the evaluation agent proposed;
 * verification accepts or rejects it before the report is built.
 */
export interface Finding {
	rule: string;
	path: string;
	lines: [number, number];
	evidence: string;
	reason: string;
	suggestion?: string;
	suggestedChange?: string;
}
