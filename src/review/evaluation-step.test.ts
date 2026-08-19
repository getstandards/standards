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
import type { Rule } from "../config/index.js";
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
	level: "MUST NOT",
	description: "Money must not be a floating-point number.",
	rationale: "Floating-point money loses cents.",
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
	it("returns the findings the agent reports and counts one invocation", async () => {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_findings", {
					findings: [
						{
							rule: "billing.no-float-money",
							path: "invoice.ts",
							lines: [1, 1],
							evidence: "const total = subtotal * 1.2",
							reason: "The total is a floating-point number.",
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

	it("lets the agent read the head checkout before it reports", async () => {
		const directory = await makeCheckout();
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read_file", { path: "invoice.ts" })]),
			fauxAssistantMessage([fauxToolCall("report_findings", { findings: [] })]),
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
