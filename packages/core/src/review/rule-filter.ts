import type { Rule } from "../rules/rule.js";

/** A `--rule` or `--folder` value that names nothing in the resolved rule set. */
export class ReviewRuleFilterError extends Error {
	public constructor(public readonly diagnostic: string) {
		super(diagnostic);
		this.name = "ReviewRuleFilterError";
	}
}

/** The rule set filters of one review invocation (specs/cli.md review). */
export interface RuleFilterOptions {
	/** Keep only the rule with this exact id. */
	rule?: string;
	/** Keep only the rules that this mapped folder produced. */
	folder?: string;
}

/**
 * Limit the resolved rule set before the pipeline runs (specs/cli.md review).
 *
 * `--rule` and `--folder` are mutually exclusive, so at most one filter
 * applies. A value that names no resolved rule and no mapped folder throws,
 * because a silent empty rule set would report a compliant review that checked
 * nothing.
 */
export function filterRuleSet(
	rules: readonly Rule[],
	options: RuleFilterOptions,
): Rule[] {
	if (options.rule !== undefined) {
		const selected = rules.filter((rule) => rule.id === options.rule);
		if (selected.length === 0) {
			throw new ReviewRuleFilterError(`Standards review could not run.

Problem:
  No resolved rule has the id '${options.rule}'.

Next action:
  Run 'standards validate' to list the resolved rule ids.`);
		}
		return selected;
	}

	if (options.folder !== undefined) {
		const selected = rules.filter((rule) => rule.folder === options.folder);
		if (selected.length === 0) {
			const folders = [...new Set(rules.map((rule) => rule.folder))].sort();
			throw new ReviewRuleFilterError(`Standards review could not run.

Problem:
  No mapped folder named '${options.folder}' produced a rule.

Next action:
  ${
		folders.length === 0
			? "Map a folder in '.standards.yml', then run 'standards validate'."
			: `Give --folder one of the mapped folders: ${folders.join(", ")}.`
	}`);
		}
		return selected;
	}

	return [...rules];
}
