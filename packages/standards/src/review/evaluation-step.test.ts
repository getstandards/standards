import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { Rule } from "../rules/rule.js";
import type { ChangedFile } from "./change-diff.js";
import type { EvaluationTask } from "./evaluation-plan.js";
import { runEvaluation } from "./evaluation-step.js";

const temporaryDirectories: string[] = [];

async function makeCheckout(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-eval-"));
	temporaryDirectories.push(directory);
	return directory;
}

const rule: Rule = {
	id: "billing.no-float-money",
	level: "MUST",
	title: "Money must not be a floating-point number.",
	description: "",
	body: "Floating-point money loses cents.",
	tags: [],
	aliases: [],
};

function taskFor(file: ChangedFile): EvaluationTask {
	return { files: [{ file, rules: [rule] }] };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("runEvaluation", () => {
	it("keeps findings of violated verdicts and discards compliant verdicts", async () => {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_rule_verdicts", {
					verdicts: [
						{
							rule: "billing.no-float-money",
							path: "invoice.ts",
							verdict: "violated",
							findings: [
								{
									first_line: 1,
									last_line: 1,
									evidence: "const total = subtotal * 1.2",
									reason: "The total is a floating-point number.",
								},
							],
						},
						{
							rule: "billing.round-half-even",
							path: "invoice.ts",
							verdict: "compliant",
							findings: [],
						},
					],
				}),
			]),
		]);

		const file: ChangedFile = {
			status: "modified",
			path: "invoice.ts",
			binary: false,
			hunks: [
				{
					baseStart: 1,
					baseLines: 0,
					headStart: 1,
					headLines: 1,
					lines: ["+const total = subtotal * 1.2"],
				},
			],
		};

		const output = await runEvaluation({
			models,
			model: faux.getModel(),
			tasks: [taskFor(file)],
			headCheckoutDir: process.cwd(),
		});

		expect(output.findings).toHaveLength(1);
		expect(output.findings[0]?.rule).toBe("billing.no-float-money");
		expect(output.usage.invocations).toBe(1);
	});

	it("keeps a non-empty suggestion and suggested change and drops empty ones", async () => {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_rule_verdicts", {
					verdicts: [
						{
							rule: "billing.no-float-money",
							path: "invoice.ts",
							verdict: "violated",
							findings: [
								{
									first_line: 1,
									last_line: 1,
									evidence: "const total = subtotal * 1.2",
									reason: "The total is a floating-point number.",
									suggestion:
										"Compute the total in minor units with the Money value object.",
									suggested_change:
										"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
								},
								{
									first_line: 3,
									last_line: 3,
									evidence: "const tip = total * 0.1",
									reason: "The tip is a floating-point number.",
									suggestion: "",
									suggested_change: "",
								},
							],
						},
					],
				}),
			]),
		]);

		const file: ChangedFile = {
			status: "modified",
			path: "invoice.ts",
			binary: false,
			hunks: [
				{
					baseStart: 1,
					baseLines: 0,
					headStart: 1,
					headLines: 3,
					lines: [
						"+const total = subtotal * 1.2",
						"+// keep",
						"+const tip = total * 0.1",
					],
				},
			],
		};

		const output = await runEvaluation({
			models,
			model: faux.getModel(),
			tasks: [taskFor(file)],
			headCheckoutDir: process.cwd(),
		});

		expect(output.findings).toHaveLength(2);
		expect(output.findings[0]?.suggestion).toBe(
			"Compute the total in minor units with the Money value object.",
		);
		expect(output.findings[0]?.suggestedChange).toBe(
			"const total = Money.fromMinorUnits((subtotalMinorUnits * 120) / 100);",
		);
		expect(output.findings[1]?.suggestion).toBeUndefined();
		expect(output.findings[1]?.suggestedChange).toBeUndefined();
	});

	it("lets the agent read the head checkout before it reports", async () => {
		const directory = await makeCheckout();
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read_file", { path: "invoice.ts" })]),
			fauxAssistantMessage([
				fauxToolCall("report_rule_verdicts", {
					verdicts: [
						{
							rule: "billing.no-float-money",
							path: "invoice.ts",
							verdict: "compliant",
							findings: [],
						},
					],
				}),
			]),
		]);

		const file: ChangedFile = {
			status: "modified",
			path: "invoice.ts",
			binary: false,
			hunks: [
				{
					baseStart: 1,
					baseLines: 1,
					headStart: 1,
					headLines: 1,
					lines: [" const total = 1;"],
				},
			],
		};

		const output = await runEvaluation({
			models,
			model: faux.getModel(),
			tasks: [taskFor(file)],
			headCheckoutDir: directory,
		});

		expect(output.findings).toEqual([]);
		expect(output.usage.invocations).toBe(1);
		expect(faux.state.callCount).toBe(2);
	});
});
