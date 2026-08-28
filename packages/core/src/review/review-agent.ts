import {
	type Api,
	type AssistantMessage,
	type Context,
	isContextOverflow,
	type Model,
	type RetryPolicy,
	retryAssistantCall,
	type Static,
	type Tool,
	type ToolCall,
	type TSchema,
	type Usage,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import type { AgentStep } from "./model-selection.js";
import { executeReadHeadFile, readHeadFileTool } from "./read-head-file.js";
import type { ReviewModels } from "./review-models.js";

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
	| "no-structured-output"
	| "invalid-output";

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
	models: ReviewModels;
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

/** The structured result of one agent invocation and the usage it spent. */
export interface ReviewAgentResult<Output> {
	output: Output;
	/** The SDK usage of the invocation, summed across its model turns. */
	usage: Usage;
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
	const usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	// Greedy decoding keeps repeated reviews of the same change as stable as
	// the provider allows.
	let sendTemperature = true;
	let invalidOutputCalls = 0;

	for (let turn = 0; turn < maxTurns; turn += 1) {
		const message = await retryAssistantCall(
			() =>
				request.models.completeSimple(request.model, context, {
					signal: request.signal,
					temperature: sendTemperature ? 0 : undefined,
				}),
			request.retryPolicy ?? DEFAULT_RETRY_POLICY,
			request.signal,
		);

		addMessageUsage(usage, message.usage);

		// Some providers accept only their default temperature (OpenCode's
		// kimi-k3 rejects everything but 1). Repeat the turn without the field.
		if (sendTemperature && isTemperatureRejectedError(message)) {
			sendTemperature = false;
			continue;
		}
		failOnProviderError(request, message);
		context.messages.push(message);

		const toolCalls = message.content.filter(
			(block): block is ToolCall => block.type === "toolCall",
		);

		const outputCall = toolCalls.find(
			(call) => call.name === request.outputTool.name,
		);

		if (outputCall !== undefined) {
			let toolArguments: Static<OutputToolSchema>;
			try {
				toolArguments = validateToolArguments(
					request.outputTool,
					outputCall,
				) as Static<OutputToolSchema>;
			} catch (error) {
				// Agent output that does not match the required structure is a
				// transient failure (specs/review.md provider failures): let the
				// model repair the call instead of failing the review. The turn
				// cap below bounds how often we ask. Every tool call gets a tool
				// result, so the transcript stays valid on providers that require
				// the pairing, and sibling reads are not lost.
				invalidOutputCalls += 1;
				for (const call of toolCalls) {
					if (call === outputCall) {
						context.messages.push({
							role: "toolResult",
							toolCallId: call.id,
							toolName: call.name,
							content: [
								{
									type: "text",
									text:
										`The ${request.outputTool.name} arguments did not match ` +
										`the required structure:\n\n${String(error)}\n\n` +
										`Call ${request.outputTool.name} again with arguments ` +
										`that match the schema. Do not answer in prose.`,
								},
							],
							isError: true,
							timestamp: Date.now(),
						});
					} else {
						context.messages.push(
							await executeReadHeadFile(request.headCheckoutDir, call),
						);
					}
				}

				continue;
			}

			return { output: request.parseOutput(toolArguments), usage };
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

	if (invalidOutputCalls > 0) {
		throw new ReviewProviderError(
			request.step,
			request.model.provider,
			request.model.id,
			"invalid-output",
			`The model returned an invalid ${request.outputTool.name} call ` +
				`${invalidOutputCalls} times within ${maxTurns} turns.`,
		);
	}
	throw new ReviewProviderError(
		request.step,
		request.model.provider,
		request.model.id,
		"no-structured-output",
		`The model did not return a ${request.outputTool.name} result within ${maxTurns} turns.`,
	);
}

/**
 * Add one model turn's usage to the invocation total.
 *
 * The cost MUST be the sum of the per-request `usage.cost` values the SDK
 * computed, never a cost recomputed from the summed tokens:
 *
 * - `Model.cost.tiers` holds request-wide pricing tiers; the highest matching
 *   `inputTokensAbove` threshold applies to the complete request.
 * - The tier threshold reads `input + cacheRead + cacheWrite` of one request.
 *   Summed tokens would cross a threshold that no single request crossed, and
 *   would over-report.
 * - Anthropic charges twice the base input rate for a one-hour cache write;
 *   the SDK applies this rule through `cacheWrite1h`.
 */
function addMessageUsage(total: Usage, usage: Usage): void {
	total.input += usage.input;
	total.output += usage.output;
	total.cacheRead += usage.cacheRead;
	total.cacheWrite += usage.cacheWrite;
	total.totalTokens += usage.totalTokens;
	total.cost.input += usage.cost.input;
	total.cost.output += usage.cost.output;
	total.cost.cacheRead += usage.cost.cacheRead;
	total.cost.cacheWrite += usage.cost.cacheWrite;
	total.cost.total += usage.cost.total;
}

/** True when the provider rejected the request's temperature value. */
function isTemperatureRejectedError(message: AssistantMessage): boolean {
	return (
		message.stopReason === "error" &&
		/temperature/i.test(message.errorMessage ?? "")
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
