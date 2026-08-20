import type { Tool } from "@earendil-works/pi-ai";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	Type,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ReviewProviderError, runReviewAgent } from "./review-agent.js";

const echoTool = {
	name: "report_echo",
	description: "Return the echoed text.",
	parameters: Type.Object({ text: Type.String() }),
} as const satisfies Tool;

function fauxModels() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, model: faux.getModel(), faux };
}

const noRetries = { enabled: false, maxRetries: 0, baseDelayMs: 0 };

describe("runReviewAgent", () => {
	it("returns the parsed output of the output tool call", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("report_echo", { text: "hello" })]),
		]);

		const result = await runReviewAgent({
			models,
			model,
			step: "evaluation",
			systemPrompt: "system",
			userText: "user",
			outputTool: echoTool,
			parseOutput: (toolArguments) => String(toolArguments.text),
			headCheckoutDir: process.cwd(),
			retryPolicy: noRetries,
		});

		expect(result.output).toBe("hello");
		expect(result.tokens.input).toBeGreaterThan(0);
	});

	it("repeats the turn without temperature when the provider rejects it", async () => {
		const { models, model, faux } = fauxModels();
		const temperatures: Array<number | undefined> = [];
		faux.setResponses([
			(_context, options) => {
				temperatures.push(options?.temperature);
				return fauxAssistantMessage("", {
					stopReason: "error",
					errorMessage:
						"400: invalid temperature: only 1 is allowed for this model",
				});
			},
			(_context, options) => {
				temperatures.push(options?.temperature);
				return fauxAssistantMessage([
					fauxToolCall("report_echo", { text: "hello" }),
				]);
			},
		]);

		const result = await runReviewAgent({
			models,
			model,
			step: "evaluation",
			systemPrompt: "system",
			userText: "user",
			outputTool: echoTool,
			parseOutput: (toolArguments) => String(toolArguments.text),
			headCheckoutDir: process.cwd(),
			retryPolicy: noRetries,
		});

		expect(result.output).toBe("hello");
		expect(temperatures).toEqual([0, undefined]);
	});

	it("fails with a provider error when a turn reports an error", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "rate limited",
			}),
		]);

		const review = runReviewAgent({
			models,
			model,
			step: "verification",
			systemPrompt: "system",
			userText: "user",
			outputTool: echoTool,
			parseOutput: (toolArguments) => String(toolArguments.text),
			headCheckoutDir: process.cwd(),
			retryPolicy: noRetries,
		});

		await expect(review).rejects.toBeInstanceOf(ReviewProviderError);
		await expect(review).rejects.toMatchObject({
			step: "verification",
			providerMessage: expect.stringContaining("rate limited"),
		});
	});

	it("fails when the model never calls the output tool", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([fauxAssistantMessage([fauxText("here is prose")])]);

		const review = runReviewAgent({
			models,
			model,
			step: "evaluation",
			systemPrompt: "system",
			userText: "user",
			outputTool: echoTool,
			parseOutput: (toolArguments) => String(toolArguments.text),
			headCheckoutDir: process.cwd(),
			retryPolicy: noRetries,
			maxTurns: 1,
		});

		await expect(review).rejects.toBeInstanceOf(ReviewProviderError);
		await expect(review).rejects.toMatchObject({
			kind: "no-structured-output",
		});
	});
});
