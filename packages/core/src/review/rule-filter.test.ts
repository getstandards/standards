import { describe, expect, it } from "vitest";
import type { Rule } from "../rules/rule.js";
import { filterRuleSet, ReviewRuleFilterError } from "./rule-filter.js";

function rule(id: string, folder: string): Rule {
	return {
		id,
		level: "MUST",
		folder,
		title: "rule statement",
		body: "rationale",
	};
}

const ruleSet = [
	rule("decisions.ttl", "decisions"),
	rule("decisions.naming", "decisions"),
	rule("practices.docs", "practices"),
];

describe("filterRuleSet", () => {
	it("keeps every rule without a filter", () => {
		expect(filterRuleSet(ruleSet, {})).toEqual(ruleSet);
	});

	it("keeps only the rule that --rule names", () => {
		expect(
			filterRuleSet(ruleSet, { rule: "decisions.ttl" }).map((one) => one.id),
		).toEqual(["decisions.ttl"]);
	});

	it("keeps only the rules of the folder that --folder names", () => {
		expect(
			filterRuleSet(ruleSet, { folder: "decisions" }).map((one) => one.id),
		).toEqual(["decisions.ttl", "decisions.naming"]);
	});

	it("names 'standards validate' for an unknown rule id", () => {
		try {
			filterRuleSet(ruleSet, { rule: "missing" });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ReviewRuleFilterError);
			expect((error as ReviewRuleFilterError).diagnostic).toContain(
				"standards validate",
			);
		}
	});

	it("lists the mapped folders for an unknown folder", () => {
		try {
			filterRuleSet(ruleSet, { folder: "missing" });
			expect.unreachable();
		} catch (error) {
			expect((error as ReviewRuleFilterError).diagnostic).toContain(
				"decisions, practices",
			);
		}
	});
});
