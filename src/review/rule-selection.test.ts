import { describe, expect, it } from "vitest";
import type { Rule } from "../config/index.js";
import type { ChangedFile } from "./change-diff.js";
import { selectRules } from "./rule-selection.js";

function rule(overrides: Partial<Rule> & Pick<Rule, "id">): Rule {
	return {
		level: "MUST",
		description: "description",
		rationale: "rationale",
		...overrides,
	};
}

function changedFile(
	overrides: Partial<ChangedFile> & Pick<ChangedFile, "path">,
): ChangedFile {
	return {
		status: "modified",
		binary: false,
		hunks: [],
		...overrides,
	};
}

describe("selectRules", () => {
	it("matches a rule to a file through its include and exclude globs", () => {
		const rules: Rule[] = [
			rule({
				id: "ts.rule",
				applies_to: { include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts"] },
			}),
		];
		const files = [
			changedFile({ path: "src/app.ts" }),
			changedFile({ path: "src/app.test.ts" }),
			changedFile({ path: "docs/readme.md" }),
		];

		const selections = selectRules(rules, files);

		expect(selections).toHaveLength(1);
		expect(selections[0]?.file.path).toBe("src/app.ts");
		expect(selections[0]?.rules.map((selected) => selected.id)).toEqual([
			"ts.rule",
		]);
	});

	it("discards a MAY rule because it cannot fail a review", () => {
		const rules: Rule[] = [rule({ id: "may.rule", level: "MAY" })];
		const files = [changedFile({ path: "src/app.ts" })];

		expect(selectRules(rules, files)).toEqual([]);
	});

	it("applies a rule without applies_to to every changed file", () => {
		const rules: Rule[] = [rule({ id: "global.rule" })];
		const files = [
			changedFile({ path: "src/app.ts" }),
			changedFile({ path: ".env.example" }),
		];

		const selections = selectRules(rules, files);

		expect(selections.map((selection) => selection.file.path)).toEqual([
			"src/app.ts",
			".env.example",
		]);
	});

	it("matches a deleted file by its base path in ChangedFile.path", () => {
		const rules: Rule[] = [
			rule({
				id: "sql.rule",
				applies_to: { include: ["migrations/**/*.sql"] },
			}),
		];
		const files = [
			changedFile({ path: "migrations/001.sql", status: "deleted" }),
		];

		const selections = selectRules(rules, files);

		expect(selections).toHaveLength(1);
		expect(selections[0]?.file.status).toBe("deleted");
	});

	it("excludes a binary file from selection", () => {
		const rules: Rule[] = [rule({ id: "global.rule" })];
		const files = [changedFile({ path: "logo.png", binary: true })];

		expect(selectRules(rules, files)).toEqual([]);
	});
});
