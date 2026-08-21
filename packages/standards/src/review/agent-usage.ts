/** Input and output token counts of one agent invocation. */
export interface AgentTokens {
	input: number;
	output: number;
}

/**
 * The model usage of one agent step, as the report shows it (specs/review.md).
 *
 * `invocations` is the number of agent invocations the step ran. `input_tokens`
 * and `output_tokens` are the provider-reported totals across those invocations.
 */
export interface StepUsage {
	invocations: number;
	input_tokens: number;
	output_tokens: number;
}

/** Return the usage of a step that has run no invocations yet. */
export function emptyStepUsage(): StepUsage {
	return { invocations: 0, input_tokens: 0, output_tokens: 0 };
}

/** Add one invocation's tokens to a step's running usage. */
export function addInvocationUsage(
	step: StepUsage,
	tokens: AgentTokens,
): StepUsage {
	return {
		invocations: step.invocations + 1,
		input_tokens: step.input_tokens + tokens.input,
		output_tokens: step.output_tokens + tokens.output,
	};
}
