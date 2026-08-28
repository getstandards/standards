import type { Usage } from "@earendil-works/pi-ai";

/**
 * The model usage of one agent step, as the report shows it (specs/review.md).
 *
 * `invocations` is the number of agent invocations the step ran. The token
 * counts are the provider-reported totals across those invocations:
 * `input_tokens` is the uncached input, `cache_read_tokens` is the input the
 * provider served from its cache, and `cache_write_tokens` is the input it
 * wrote to its cache. `cost` is the step's model spend in United States
 * dollars.
 */
export interface StepUsage {
	invocations: number;
	input_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	output_tokens: number;
	cost: number;
}

/** Return the usage of a step that has run no invocations yet. */
export function emptyStepUsage(): StepUsage {
	return {
		invocations: 0,
		input_tokens: 0,
		cache_read_tokens: 0,
		cache_write_tokens: 0,
		output_tokens: 0,
		cost: 0,
	};
}

/** Add one invocation's SDK usage to a step's running usage. */
export function addInvocationUsage(step: StepUsage, usage: Usage): StepUsage {
	return {
		invocations: step.invocations + 1,
		input_tokens: step.input_tokens + usage.input,
		cache_read_tokens: step.cache_read_tokens + usage.cacheRead,
		cache_write_tokens: step.cache_write_tokens + usage.cacheWrite,
		output_tokens: step.output_tokens + usage.output,
		cost: step.cost + usage.cost.total,
	};
}

/** Format a cost in United States dollars for a text surface, as `$0.0523`. */
export function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}
