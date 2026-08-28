import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { runGit } from "@getstandards/core/internal";
import { afterEach, describe, expect, it } from "vitest";
import { parseStandardsArgs } from "./command-args.js";
import { runStandardsReview } from "./standards-review.js";

const temporaryDirectories: string[] = [];

/**
 * Create a repository with one local knowledge source and one committed file,
 * then change that file so the working tree carries the reviewed change.
 */
async function createFixtureRepository(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-pi-"));
	temporaryDirectories.push(directory);
	await runGit(["init", "-q", "-b", "main"], directory);
	await runGit(["config", "user.email", "test@example.com"], directory);
	await runGit(["config", "user.name", "Test"], directory);

	await writeFile(
		path.join(directory, ".standards.yml"),
		`version: 2
sources:
  - path: ./knowledge
    folders:
      decisions:
        level: MUST
        applies_to:
          include: ["**/*.ts"]
`,
	);
	await mkdir(path.join(directory, "knowledge", "decisions", "money"), {
		recursive: true,
	});
	await writeFile(
		path.join(directory, "knowledge", "decisions", "money", "no-float.md"),
		"---\ntitle: Money must not be a floating-point number.\n---\n\nFloating-point money loses cents.\n",
	);
	await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
	await runGit(["add", "-A"], directory);
	await runGit(["commit", "-q", "-m", "base"], directory);

	await writeFile(
		path.join(directory, "invoice.ts"),
		"const total = subtotal * 1.2;\n",
	);
	return directory;
}

/** A models runtime whose evaluation reports one violation of `money.no-float`. */
function fakeModels(verdict: "compliant" | "violated") {
	const faux = fauxProvider({
		provider: "anthropic",
		models: [{ id: "claude-sonnet-5" }],
	});
	const models = createModels();
	models.setProvider(faux.provider);
	const respond: FauxResponseFactory = (context) => {
		if ((context.systemPrompt ?? "").includes("report_rule_verdicts")) {
			return fauxAssistantMessage([
				fauxToolCall("report_rule_verdicts", {
					verdicts: [
						{
							rule: "money.no-float",
							path: "invoice.ts",
							verdict,
							findings:
								verdict === "compliant"
									? []
									: [
											{
												first_line: 1,
												last_line: 1,
												evidence: "const total = subtotal * 1.2",
												reason: "The total is a floating-point number.",
												suggested_change:
													"const total = subtotalCents * 120n / 100n;",
											},
										],
						},
					],
				}),
			]);
		}
		return fauxAssistantMessage([
			fauxToolCall("report_verdict", {
				confirmed: true,
				accepts_suggested_change: true,
			}),
		]);
	};
	faux.setResponses([respond, respond]);
	return models;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("runStandardsReview", () => {
	it("reports a confirmed finding of the working tree change", async () => {
		const directory = await createFixtureRepository();

		const outcome = await runStandardsReview(
			{
				cwd: directory,
				models: fakeModels("violated"),
				activeModel: "anthropic/claude-sonnet-5",
				environment: { HOME: directory },
			},
			parseStandardsArgs("--base HEAD"),
		);

		expect(outcome.kind).toBe("report");
		if (outcome.kind !== "report") {
			return;
		}
		expect(outcome.report.conclusion).toBe("non-compliant");
		expect(outcome.report.findings).toHaveLength(1);
		expect(outcome.report.findings[0]?.rule).toBe("money.no-float");
		expect(outcome.report.findings[0]?.path).toBe("invoice.ts");
		expect(outcome.report.findings[0]?.suggested_change).toBe(
			"const total = subtotalCents * 120n / 100n;",
		);
		// The active model is the last resort, so a review needs no extra setup.
		expect(outcome.report.models.evaluation).toBe("anthropic/claude-sonnet-5");
	});

	it("reports a compliant conclusion when no rule is violated", async () => {
		const directory = await createFixtureRepository();

		const outcome = await runStandardsReview(
			{
				cwd: directory,
				models: fakeModels("compliant"),
				activeModel: "anthropic/claude-sonnet-5",
				environment: { HOME: directory },
			},
			parseStandardsArgs("--base HEAD"),
		);

		expect(outcome.kind).toBe("report");
		if (outcome.kind !== "report") {
			return;
		}
		expect(outcome.report.conclusion).toBe("compliant");
		expect(outcome.report.findings).toEqual([]);
	});

	it("reports a diagnostic instead of a conclusion when there is no entry file", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "standards-pi-"));
		temporaryDirectories.push(directory);
		await runGit(["init", "-q", "-b", "main"], directory);
		await runGit(["config", "user.email", "test@example.com"], directory);
		await runGit(["config", "user.name", "Test"], directory);
		await writeFile(path.join(directory, "invoice.ts"), "const total = 1;\n");
		await runGit(["add", "-A"], directory);
		await runGit(["commit", "-q", "-m", "base"], directory);

		const outcome = await runStandardsReview(
			{
				cwd: directory,
				models: fakeModels("compliant"),
				activeModel: "anthropic/claude-sonnet-5",
				environment: { HOME: directory },
			},
			parseStandardsArgs("--base HEAD"),
		);

		expect(outcome.kind).toBe("diagnostic");
		if (outcome.kind !== "diagnostic") {
			return;
		}
		expect(outcome.diagnostic).toContain(".standards.yml");
		expect(outcome.diagnostic).toContain("Next action:");
	});

	it("reports a diagnostic when a target matches nothing in the change", async () => {
		const directory = await createFixtureRepository();

		const outcome = await runStandardsReview(
			{
				cwd: directory,
				models: fakeModels("compliant"),
				activeModel: "anthropic/claude-sonnet-5",
				environment: { HOME: directory },
			},
			parseStandardsArgs("--base HEAD missing.ts"),
		);

		expect(outcome.kind).toBe("diagnostic");
		if (outcome.kind !== "diagnostic") {
			return;
		}
		expect(outcome.diagnostic).toContain("missing.ts");
	});
});
