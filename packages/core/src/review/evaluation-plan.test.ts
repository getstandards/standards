import { describe, expect, it } from "vitest";
import type { Rule } from "../rules/rule.js";
import type { ChangedFile } from "./change-diff.js";
import { planEvaluationTasks } from "./evaluation-plan.js";
import type { FileSelection } from "./rule-selection.js";

function selection(path: string, ruleIds: string[]): FileSelection {
	const file: ChangedFile = {
		status: "modified",
		path,
		binary: false,
		hunks: [],
	};
	const rules: Rule[] = ruleIds.map((id) => ({
		id,
		level: "MUST",
		folder: "decisions",
		title: "rule statement",
		description: "",
		body: "rationale",
	}));
	return { file, rules };
}

describe("planEvaluationTasks", () => {
	it("puts each changed file in exactly one task with all its rules", () => {
		const selections = [
			selection("src/a.ts", ["rule.one", "rule.two"]),
			selection("src/b.ts", ["rule.one"]),
		];

		const tasks = planEvaluationTasks(selections);

		expect(tasks).toHaveLength(2);
		const paths = tasks.flatMap((task) =>
			task.files.map((entry) => entry.file.path),
		);
		expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
		expect(tasks[0]?.files[0]?.rules.map((rule) => rule.id)).toEqual([
			"rule.one",
			"rule.two",
		]);
	});

	it("returns no tasks for an empty selection", () => {
		expect(planEvaluationTasks([])).toEqual([]);
	});
});
