import picomatch from "picomatch";
import type { Rule } from "../rules/rule.js";

/**
 * Match repository paths with `/` separators and dot files included.
 *
 * Rule globs are repository-relative and case-sensitive; `*` and `?` do not
 * cross a `/`, and `**` spans whole path segments (specs/configuration.md).
 */
const APPLIES_TO_MATCH_OPTIONS: picomatch.PicomatchOptions = { dot: true };

/**
 * Build a predicate that tests a repository path against a rule's applies_to
 * filter.
 *
 * A path applies when it matches at least one `include` glob and no `exclude`
 * glob; exclusion wins. The default `include` glob selects every file and the
 * default `exclude` list is empty (specs/configuration.md).
 */
export function compileAppliesTo(
	appliesTo: Rule["applies_to"],
): (path: string) => boolean {
	const isIncluded = picomatch(
		appliesTo?.include ?? ["**/*"],
		APPLIES_TO_MATCH_OPTIONS,
	);
	const exclude = appliesTo?.exclude ?? [];
	const isExcluded =
		exclude.length === 0
			? () => false
			: picomatch(exclude, APPLIES_TO_MATCH_OPTIONS);
	return (path) => isIncluded(path) && !isExcluded(path);
}
