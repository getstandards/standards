import type { Api, Model, Models, Tool } from "@earendil-works/pi-ai";
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

const echoTool: Tool = {
	name: "report_echo",
	description: "Return the echoed text.",
	parameters: Type.Object({ text: Type.String() }),
};

function fauxModels(): {
	models: Models;
	model: Model<Api>;
	faux: ReturnType<typeof fauxProvider>;
} {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, model: faux.getModel() as Model<Api>, faux };
}

const noRetries = { enabled: false, maxRetries: 0, baseDelayMs: 0 };

describe("runReviewAgent", () => {
	it("returns the parsed output of the output tool call", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("report_echo", { text: "hello" })]),
		]);

		const result = await runReviewAgent<string>({
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

	it("fails with a provider error when a turn reports an error", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "rate limited",
			}),
		]);

		const error = await runReviewAgent<string>({
			models,
			model,
			step: "verification",
			systemPrompt: "system",
			userText: "user",
			outputTool: echoTool,
			parseOutput: (toolArguments) => String(toolArguments.text),
			headCheckoutDir: process.cwd(),
			retryPolicy: noRetries,
		}).catch((thrown) => thrown);

		expect(error).toBeInstanceOf(ReviewProviderError);
		expect((error as ReviewProviderError).step).toBe("verification");
		expect((error as ReviewProviderError).providerMessage).toContain(
			"rate limited",
		);
	});

	it("fails when the model never calls the output tool", async () => {
		const { models, model, faux } = fauxModels();
		faux.setResponses([fauxAssistantMessage([fauxText("here is prose")])]);

		const error = await runReviewAgent<string>({
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
		}).catch((thrown) => thrown);

		expect(error).toBeInstanceOf(ReviewProviderError);
		expect((error as ReviewProviderError).kind).toBe("no-structured-output");
	});
});
