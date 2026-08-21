import type { Rule } from "../config/index.js";
import { compileAppliesTo } from "./applies-to-match.js";
import type { ChangedFile } from "./change-diff.js";

/** The rules selected for one changed file (specs/review.md step 1). */
export interface FileSelection {
	file: ChangedFile;
	rules: Rule[];
}

/**
 * Select the rules that apply to each changed file (specs/review.md step 1).
 *
 * A rule is discarded when it is a `MAY` rule, because a `MAY` rule cannot fail
 * a review, or when its applies_to filter matches no changed file. A binary
 * file is not evaluated and is excluded from selection. A changed file matches
 * with its head path, or its base path when it was deleted; `ChangedFile.path`
 * already holds the matching path. A file with no selected rule is left out, so
 * planning creates no task for it.
 */
export function selectRules(
	ruleSet: readonly Rule[],
	changedFiles: readonly ChangedFile[],
): FileSelection[] {
	const evaluableRules = ruleSet
		.filter((rule) => rule.level !== "MAY")
		.map((rule) => ({ rule, matches: compileAppliesTo(rule.applies_to) }));

	const selections: FileSelection[] = [];
	for (const file of changedFiles) {
		if (file.binary) {
			continue;
		}
		const rules = evaluableRules
			.filter((entry) => entry.matches(file.path))
			.map((entry) => entry.rule);
		if (rules.length > 0) {
			selections.push({ file, rules });
		}
	}
	return selections;
}
