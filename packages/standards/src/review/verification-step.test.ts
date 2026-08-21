import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { Rule } from "../config/index.js";
import type { Finding } from "./finding.js";
import { dedupeFindings, runVerification } from "./verification-step.js";

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
