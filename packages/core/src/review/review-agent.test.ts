import type { Message, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
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

function toolResults(messages: Message[]): ToolResultMessage[] {
	return messages.filter(
		(message): message is ToolResultMessage => message.role === "toolResult",
	);
}

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
		expect(result.usage.input).toBeGreaterThan(0);
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

	it("lets the model repair a tool call whose arguments fail validation", async () => {
		const { models, model, faux } = fauxModels();
		let repairResults: ToolResultMessage[] = [];
		faux.setResponses([
			// reason-as-object style mistake: the argument is not a string.
			fauxAssistantMessage([
				fauxToolCall("report_echo", { text: { nested: "not a string" } }),
			]),
			(context) => {
				repairResults = toolResults(context.messages);
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
		// The invalid call got an error tool result that carries the schema
		// error, so the transcript stays paired and the model can repair.
		expect(repairResults).toHaveLength(1);
		expect(repairResults[0]).toMatchObject({
			toolName: "report_echo",
			isError: true,
		});
		expect(repairResults[0]?.content).toMatchObject([
			{
				type: "text",
				text: expect.stringContaining("did not match the required structure"),
			},
		]);
	});

	it("answers sibling read_file calls when the output call is invalid", async () => {
		const { models, model, faux } = fauxModels();
		let repairResults: ToolResultMessage[] = [];
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("read_file", { path: "package.json" }),
				fauxToolCall("report_echo", { text: { nested: true } }),
			]),
			(context) => {
				repairResults = toolResults(context.messages);
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
		expect(repairResults).toHaveLength(2);
		expect(repairResults[0]).toMatchObject({
			toolName: "read_file",
			isError: false,
		});
		expect(repairResults[1]).toMatchObject({
			toolName: "report_echo",
			isError: true,
		});
	});

	it("fails when the model never repairs an invalid tool call", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("report_echo", { text: { nested: true } }),
			]),
			fauxAssistantMessage([
				fauxToolCall("report_echo", { text: { nested: true } }),
			]),
		]);

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
			maxTurns: 2,
		});

		await expect(review).rejects.toBeInstanceOf(ReviewProviderError);
		await expect(review).rejects.toMatchObject({
			kind: "invalid-output",
			providerMessage: expect.stringContaining(
				"invalid report_echo call 2 times",
			),
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
