import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { Rule } from "../config/index.js";
import { runGit } from "../utils/git.js";
import { runReview } from "./run-review.js";

const temporaryDirectories: string[] = [];

async function initRepository(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-review-"));
	temporaryDirectories.push(directory);
	await runGit(["init", "-q", "-b", "main"], directory);
	await runGit(["config", "user.email", "test@example.com"], directory);
	await runGit(["config", "user.name", "Test"], directory);
	return directory;
}

async function commitAll(directory: string, message: string): Promise<string> {
	await runGit(["add", "-A"], directory);
	await runGit(["commit", "-q", "-m", message], directory);
	return runGit(["rev-parse", "HEAD"], directory);
}

/** A faux Anthropic model so model selection resolves to its default model. */
function anthropicFaux() {
	const faux = fauxProvider({
		provider: "anthropic",
		models: [{ id: "claude-sonnet-5" }],
	});
	const models = createModels();
	models.setProvider(faux.provider);
	return { faux, models };
}

const moneyRule: Rule = {
	id: "money.no-float",
	level: "MUST NOT",
	description: "Money must not be a floating-point number.",
	rationale: "Floating-point money loses cents.",
	applies_to: { include: ["**/*.ts"] },
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("runReview", () => {
	it("reports a non-compliant conclusion for a confirmed MUST NOT finding", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		const base = await commitAll(directory, "base");
		await writeFile(
			path.join(directory, "invoice.ts"),
			"const total = subtotal * 1.2;\n",
		);
		const head = await commitAll(directory, "head");

		const { faux, models } = anthropicFaux();
		// Respond by the system prompt: evaluation calls report_rule_verdicts,
		// verification calls report_verdict.
		const respond: FauxResponseFactory = (context) => {
			if ((context.systemPrompt ?? "").includes("report_rule_verdicts")) {
				return fauxAssistantMessage([
					fauxToolCall("report_rule_verdicts", {
						verdicts: [
							{
								rule: "money.no-float",
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
						],
					}),
				]);
			}
			return fauxAssistantMessage([
				fauxToolCall("report_verdict", { confirmed: true }),
			]);
		};
		faux.setResponses([respond, respond]);

		const report = await runReview({
			baseRevision: base,
			headRevision: head,
			workingDirectory: directory,
			ruleSet: [moneyRule],
			models,
			environment: {},
		});

		expect(report.conclusion).toBe("non-compliant");
		expect(report.counts).toEqual({
			resolved_rules: 1,
			selected_rules: 1,
			evaluation_tasks: 1,
		});
		expect(report.findings).toHaveLength(1);
		expect(report.usage.evaluation.invocations).toBe(1);
		expect(report.usage.verification.invocations).toBe(1);
		expect(report.models.evaluation).toBe("anthropic/claude-sonnet-5");
	});

	it("limits the review to the changed files a target matches", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		await writeFile(path.join(directory, "cart.ts"), "const cart = 1;\n");
		const base = await commitAll(directory, "base");
		await writeFile(
			path.join(directory, "invoice.ts"),
			"const total = subtotal * 1.2;\n",
		);
		await writeFile(
			path.join(directory, "cart.ts"),
			"const cart = price * 1.2;\n",
		);
		const head = await commitAll(directory, "head");

		const { faux, models } = anthropicFaux();
		const respond: FauxResponseFactory = (context) => {
			if ((context.systemPrompt ?? "").includes("report_rule_verdicts")) {
				return fauxAssistantMessage([
					fauxToolCall("report_rule_verdicts", {
						verdicts: [
							{
								rule: "money.no-float",
								path: "invoice.ts",
								verdict: "compliant",
								findings: [],
							},
						],
					}),
				]);
			}
			return fauxAssistantMessage([
				fauxToolCall("report_verdict", { confirmed: true }),
			]);
		};
		faux.setResponses([respond]);
		const progressLines: string[] = [];

		const report = await runReview({
			baseRevision: base,
			headRevision: head,
			workingDirectory: directory,
			targets: ["invoice.ts"],
			ruleSet: [moneyRule],
			models,
			environment: {},
			reportProgress: (line) => progressLines.push(line),
		});

		expect(report.counts.evaluation_tasks).toBe(1);
		expect(report.usage.evaluation.invocations).toBe(1);
		expect(progressLines).toEqual([
			"Evaluating 1 selected file in 1 evaluation task.",
		]);
	});

	it("reports detailed progress with reportVerbose", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		const base = await commitAll(directory, "base");
		await writeFile(
			path.join(directory, "invoice.ts"),
			"const total = subtotal * 1.2;\n",
		);
		const head = await commitAll(directory, "head");

		const { faux, models } = anthropicFaux();
		// Evaluation returns two duplicate findings; verification rejects the
		// one that survives deduplication, so the review reports no finding.
		const respond: FauxResponseFactory = (context) => {
			if ((context.systemPrompt ?? "").includes("report_rule_verdicts")) {
				return fauxAssistantMessage([
					fauxToolCall("report_rule_verdicts", {
						verdicts: [
							{
								rule: "money.no-float",
								path: "invoice.ts",
								verdict: "violated",
								findings: [
									{
										first_line: 1,
										last_line: 1,
										evidence: "const total = subtotal * 1.2",
										reason: "The total is a floating-point number.",
									},
									{
										first_line: 1,
										last_line: 2,
										evidence: "const total = subtotal * 1.2",
										reason: "The total is a floating-point number.",
									},
								],
							},
						],
					}),
				]);
			}
			return fauxAssistantMessage([
				fauxToolCall("report_verdict", { confirmed: false }),
			]);
		};
		faux.setResponses([respond, respond]);
		const verboseLines: string[] = [];

		const report = await runReview({
			baseRevision: base,
			headRevision: head,
			workingDirectory: directory,
			targets: ["invoice.ts"],
			ruleSet: [moneyRule],
			models,
			environment: {},
			reportVerbose: (line) => verboseLines.push(line),
		});

		expect(report.conclusion).toBe("compliant");
		expect(report.findings).toEqual([]);
		expect(verboseLines).toEqual([
			`Base revision: ${base}`,
			`Head revision: ${head}`,
			"Targets: invoice.ts",
			"Selected invoice.ts (modified): money.no-float",
			"Evaluation task 1/1: invoice.ts (rules: money.no-float)",
			"Evaluating task 1/1: invoice.ts.",
			"Discarded duplicate finding: money.no-float at invoice.ts:1-2.",
			"Verifying finding 1/1: money.no-float at invoice.ts:1-1.",
			"Rejected finding: money.no-float at invoice.ts:1-1.",
		]);
	});

	it("rejects a target that does not exist in the head revision", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		const base = await commitAll(directory, "base");
		await writeFile(path.join(directory, "invoice.ts"), "const total = 2;\n");
		const head = await commitAll(directory, "head");

		const { models } = anthropicFaux();

		await expect(
			runReview({
				baseRevision: base,
				headRevision: head,
				workingDirectory: directory,
				targets: ["missing.ts"],
				ruleSet: [moneyRule],
				models,
				environment: {},
			}),
		).rejects.toThrow("Target 'missing.ts' does not exist");
	});

	it("ends compliant with zero invocations when no rule is selected", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "notes.md"), "# notes\n");
		const base = await commitAll(directory, "base");
		await writeFile(path.join(directory, "notes.md"), "# notes updated\n");
		const head = await commitAll(directory, "head");

		const { faux, models } = anthropicFaux();

		const report = await runReview({
			baseRevision: base,
			headRevision: head,
			workingDirectory: directory,
			ruleSet: [moneyRule],
			models,
			environment: {},
		});

		expect(report.conclusion).toBe("compliant");
		expect(report.counts.selected_rules).toBe(0);
		expect(report.counts.evaluation_tasks).toBe(0);
		expect(report.findings).toEqual([]);
		expect(faux.state.callCount).toBe(0);
	});
});
