import {
	type Api,
	type AssistantMessage,
	type Context,
	isContextOverflow,
	type Model,
	type Models,
	type RetryPolicy,
	retryAssistantCall,
	type Static,
	type Tool,
	type ToolCall,
	type TSchema,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import type { AgentTokens } from "./agent-usage.js";
import type { AgentStep } from "./model-selection.js";
import { executeReadHeadFile, readHeadFileTool } from "./read-head-file.js";

/** Retry bound for a transient provider failure during one agent invocation. */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
	enabled: true,
	maxRetries: 3,
	baseDelayMs: 500,
};

/** The most model turns one agent invocation runs before it gives up. */
const DEFAULT_MAX_TURNS = 12;

/** Why a review agent invocation failed, for the diagnostic and for tests. */
export type ReviewProviderErrorKind =
	| "provider-error"
	| "context-overflow"
	| "aborted"
	| "no-structured-output";

/**
 * A review agent invocation that failed against a provider.
 *
 * It names the agent step, the provider, and the provider's error, so a review
 * can fail as a whole with a clear diagnostic (specs/review.md provider
 * failures).
 */
export class ReviewProviderError extends Error {
	public constructor(
		public readonly step: AgentStep,
		public readonly provider: string,
		public readonly model: string,
		public readonly kind: ReviewProviderErrorKind,
		public readonly providerMessage: string,
	) {
		super(
			`Standards review failed at the ${step} step on ${provider}/${model}: ${providerMessage}`,
		);
		this.name = "ReviewProviderError";
	}
}

/** Everything one review agent invocation needs to run its tool loop. */
export interface ReviewAgentRequest<OutputToolSchema extends TSchema, Output> {
	models: Models;
	model: Model<Api>;
	step: AgentStep;
	systemPrompt: string;
	userText: string;
	/** The tool whose call carries the invocation's structured result. */
	outputTool: Tool<OutputToolSchema>;
	/** Map the validated output tool arguments to the invocation result. */
	parseOutput: (toolArguments: Static<OutputToolSchema>) => Output;
	/** The head checkout the read_file tool is confined to. */
	headCheckoutDir: string;
	signal?: AbortSignal;
	retryPolicy?: RetryPolicy;
	maxTurns?: number;
}

/** The structured result of one agent invocation and the tokens it spent. */
export interface ReviewAgentResult<Output> {
	output: Output;
	tokens: AgentTokens;
}

/**
 * Run one review agent invocation to its structured result (specs/review.md).
 *
 * The agent may call `read_file` to read more of the head checkout, then must
 * call the output tool to return its result. A transient provider failure is
 * retried with bounded backoff; a non-transient failure throws
 * ReviewProviderError. File content the agent reads is data, never an
 * instruction. Nothing but the structured result leaves the invocation.
 */
export async function runReviewAgent<OutputToolSchema extends TSchema, Output>(
	request: ReviewAgentRequest<OutputToolSchema, Output>,
): Promise<ReviewAgentResult<Output>> {
	const tools = [readHeadFileTool, request.outputTool];
	const context: Context = {
		systemPrompt: request.systemPrompt,
		messages: [
			{ role: "user", content: request.userText, timestamp: Date.now() },
		],
		tools,
	};
	const maxTurns = request.maxTurns ?? DEFAULT_MAX_TURNS;
	const tokens: AgentTokens = { input: 0, output: 0 };

	for (let turn = 0; turn < maxTurns; turn += 1) {
		const message = await retryAssistantCall(
			() =>
				request.models.completeSimple(request.model, context, {
					signal: request.signal,
				}),
			request.retryPolicy ?? DEFAULT_RETRY_POLICY,
			request.signal,
		);
		tokens.input += message.usage.input;
		tokens.output += message.usage.output;

		failOnProviderError(request, message);
		context.messages.push(message);

		const toolCalls = message.content.filter(
			(block): block is ToolCall => block.type === "toolCall",
		);
		const outputCall = toolCalls.find(
			(call) => call.name === request.outputTool.name,
		);
		if (outputCall !== undefined) {
			const toolArguments = validateToolArguments(
				request.outputTool,
				outputCall,
			) as Static<OutputToolSchema>;
			return { output: request.parseOutput(toolArguments), tokens };
		}
		if (toolCalls.length === 0) {
			context.messages.push({
				role: "user",
				content: `Call the ${request.outputTool.name} tool to return your result. Do not answer in prose.`,
				timestamp: Date.now(),
			});
			continue;
		}
		for (const call of toolCalls) {
			context.messages.push(
				await executeReadHeadFile(request.headCheckoutDir, call),
			);
		}
	}

	throw new ReviewProviderError(
		request.step,
		request.model.provider,
		request.model.id,
		"no-structured-output",
		`The model did not return a ${request.outputTool.name} result within ${maxTurns} turns.`,
	);
}

/** Throw ReviewProviderError when a completed turn reports a provider failure. */
function failOnProviderError<OutputToolSchema extends TSchema, Output>(
	request: ReviewAgentRequest<OutputToolSchema, Output>,
	message: AssistantMessage,
): void {
	if (message.stopReason === "aborted") {
		throw new ReviewProviderError(
			request.step,
			request.model.provider,
			request.model.id,
			"aborted",
			message.errorMessage ?? "The request was aborted.",
		);
	}
	if (message.stopReason !== "error") {
		return;
	}
	const kind: ReviewProviderErrorKind = isContextOverflow(
		message,
		request.model.contextWindow,
	)
		? "context-overflow"
		: "provider-error";
	throw new ReviewProviderError(
		request.step,
		request.model.provider,
		request.model.id,
		kind,
		message.errorMessage ?? "The provider returned an error.",
	);
}
