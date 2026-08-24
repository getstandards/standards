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
import type { Finding } from "./finding.js";
import {
	dedupeFindings,
	dropUnusableSuggestedChange,
	runVerification,
} from "./verification-step.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

const rule: Rule = {
	id: "billing.no-float-money",
	level: "MUST NOT",
	description: "Money must not be a floating-point number.",
	rationale: "Floating-point money loses cents.",
};

function finding(overrides: Partial<Finding>): Finding {
	return {
		rule: "billing.no-float-money",
		path: "invoice.ts",
		lines: [10, 12],
		evidence: "const total = subtotal * 1.2",
		reason: "The total is a floating-point number.",
		...overrides,
	};
}

describe("dedupeFindings", () => {
	it("drops a later finding with the same rule, path, and overlapping lines", () => {
		const findings = [
			finding({ lines: [10, 12] }),
			finding({ lines: [11, 13] }),
			finding({ lines: [40, 41] }),
		];

		const kept = dedupeFindings(findings);

		expect(kept.map((entry) => entry.lines)).toEqual([
			[10, 12],
			[40, 41],
		]);
	});

	it("keeps findings that differ in rule or path", () => {
		const findings = [
			finding({ path: "invoice.ts" }),
			finding({ path: "order.ts" }),
			finding({ rule: "other.rule", path: "invoice.ts" }),
		];

		expect(dedupeFindings(findings)).toHaveLength(3);
	});
});

describe("runVerification", () => {
	it("keeps a confirmed finding and drops a rejected one", async () => {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		// Both invocations share one faux queue and run concurrently, so respond
		// by message content instead of queue order: reject order.ts, confirm the rest.
		const verdictByContent: FauxResponseFactory = (context) => {
			const rejected = JSON.stringify(context.messages).includes("order.ts");
			return fauxAssistantMessage([
				fauxToolCall("report_verdict", { confirmed: !rejected }),
			]);
		};
		faux.setResponses([verdictByContent, verdictByContent]);

		const output = await runVerification({
			models,
			model: faux.getModel(),
			findings: [
				finding({ path: "invoice.ts", lines: [1, 1] }),
				finding({ path: "order.ts", lines: [1, 1] }),
			],
			ruleSet: [rule],
			headCheckoutDir: process.cwd(),
		});

		expect(output.findings).toHaveLength(1);
		expect(output.findings[0]?.path).toBe("invoice.ts");
		expect(output.usage.invocations).toBe(2);
	});
});

describe("dropUnusableSuggestedChange", () => {
	async function checkout(files: Record<string, string>): Promise<string> {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "standards-verify-"),
		);
		temporaryDirectories.push(directory);
		for (const [name, content] of Object.entries(files)) {
			await writeFile(path.join(directory, name), content);
		}
		return directory;
	}

	it("keeps a candidate that exactly changes the head lines", async () => {
		const directory = await checkout({
			"invoice.ts": "const total = subtotal * 1.2;\nconst tip = 0.1;\n",
		});
		const finding: Finding = {
			rule: "money.no-float",
			path: "invoice.ts",
			lines: [1, 1],
			evidence: "const total = subtotal * 1.2",
			reason: "The total is a floating-point number.",
			suggestedChange: "const total = Money.fromMinorUnits(1200);",
		};

		const cleaned = await dropUnusableSuggestedChange(finding, directory);

		expect(cleaned.suggestedChange).toBe(
			"const total = Money.fromMinorUnits(1200);",
		);
	});

	it("drops the candidate when the file is not in the head revision", async () => {
		const directory = await checkout({});
		const finding: Finding = {
			rule: "money.no-float",
			path: "invoice.ts",
			lines: [1, 1],
			evidence: "const total = subtotal * 1.2",
			reason: "The total is a floating-point number.",
			suggestedChange: "const total = Money.fromMinorUnits(1200);",
		};

		const cleaned = await dropUnusableSuggestedChange(finding, directory);

		expect(cleaned.suggestedChange).toBeUndefined();
		expect(cleaned.reason).toBe(finding.reason);
	});

	it("drops the candidate when the line range is not valid in the file", async () => {
		const directory = await checkout({ "invoice.ts": "const total = 1;\n" });
		const finding: Finding = {
			rule: "money.no-float",
			path: "invoice.ts",
			lines: [9, 12],
			evidence: "const total = subtotal * 1.2",
			reason: "The total is a floating-point number.",
			suggestedChange: "const total = Money.fromMinorUnits(1200);",
		};

		const cleaned = await dropUnusableSuggestedChange(finding, directory);

		expect(cleaned.suggestedChange).toBeUndefined();
		expect(cleaned.path).toBe("invoice.ts");
	});

	it("drops the candidate whose range reaches past the final line break", async () => {
		// The file has one line; its final line break is not an extra line.
		const directory = await checkout({
			"invoice.ts": "const total = subtotal * 1.2;\n",
		});
		const finding: Finding = {
			rule: "money.no-float",
			path: "invoice.ts",
			lines: [1, 2],
			evidence: "const total = subtotal * 1.2",
			reason: "The total is a floating-point number.",
			suggestedChange: "const total = Money.fromMinorUnits(1200);",
		};

		const cleaned = await dropUnusableSuggestedChange(finding, directory);

		expect(cleaned.suggestedChange).toBeUndefined();
	});

	it("drops the candidate identical to the current line range", async () => {
		const directory = await checkout({
			"invoice.ts": "const total = subtotal * 1.2;\n",
		});
		const finding: Finding = {
			rule: "money.no-float",
			path: "invoice.ts",
			lines: [1, 1],
			evidence: "const total = subtotal * 1.2",
			reason: "The total is a floating-point number.",
			suggestedChange: "const total = subtotal * 1.2;",
		};

		const cleaned = await dropUnusableSuggestedChange(finding, directory);

		expect(cleaned.suggestedChange).toBeUndefined();
	});

	it("compares against the complete multi-line range", async () => {
		const directory = await checkout({
			"invoice.ts": "const total = subtotal * 1.2;\nconst tip = total * 0.1;\n",
		});
		const finding: Finding = {
			rule: "money.no-float",
			path: "invoice.ts",
			lines: [1, 2],
			evidence: "const total = subtotal * 1.2",
			reason: "The total is a floating-point number.",
			suggestedChange:
				"const total = Money.fromMinorUnits(1200);\nconst tip = total.times(0.1);",
		};

		const cleaned = await dropUnusableSuggestedChange(finding, directory);

		expect(cleaned.suggestedChange).toBe(
			"const total = Money.fromMinorUnits(1200);\nconst tip = total.times(0.1);",
		);
	});
});

describe("runVerification suggested changes", () => {
	it("accepts a candidate the verifier accepts and keeps the finding", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "standards-v-"));
		temporaryDirectories.push(directory);
		await writeFile(
			path.join(directory, "invoice.ts"),
			"const total = subtotal * 1.2;\n",
		);
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_verdict", {
					confirmed: true,
					accepts_suggested_change: true,
				}),
			]),
		]);

		const output = await runVerification({
			models,
			model: faux.getModel(),
			findings: [
				finding({
					lines: [1, 1],
					suggestedChange: "const total = Money.fromMinorUnits(1200);",
				}),
			],
			ruleSet: [rule],
			headCheckoutDir: directory,
		});

		expect(output.findings).toHaveLength(1);
		expect(output.findings[0]?.suggestedChange).toBe(
			"const total = Money.fromMinorUnits(1200);",
		);
	});

	it("removes a rejected suggested change but keeps the confirmed finding", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "standards-v-"));
		temporaryDirectories.push(directory);
		await writeFile(
			path.join(directory, "invoice.ts"),
			"const total = subtotal * 1.2;\n",
		);
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_verdict", {
					confirmed: true,
					accepts_suggested_change: false,
				}),
			]),
		]);

		const output = await runVerification({
			models,
			model: faux.getModel(),
			findings: [
				finding({
					lines: [1, 1],
					suggestedChange: "const total = Money.fromMinorUnits(1200);",
				}),
			],
			ruleSet: [rule],
			headCheckoutDir: directory,
		});

		expect(output.findings).toHaveLength(1);
		expect(output.findings[0]?.suggestedChange).toBeUndefined();
	});

	it("does not add a suggested change without an explicit acceptance", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "standards-v-"));
		temporaryDirectories.push(directory);
		await writeFile(
			path.join(directory, "invoice.ts"),
			"const total = subtotal * 1.2;\n",
		);
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_verdict", { confirmed: true }),
			]),
		]);

		const output = await runVerification({
			models,
			model: faux.getModel(),
			findings: [
				finding({
					lines: [1, 1],
					suggestedChange: "const total = Money.fromMinorUnits(1200);",
				}),
			],
			ruleSet: [rule],
			headCheckoutDir: directory,
		});

		expect(output.findings[0]?.suggestedChange).toBeUndefined();
	});
});
