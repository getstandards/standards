import type { Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { addInvocationUsage, emptyStepUsage } from "./agent-usage.js";

/** An SDK usage with distinct values, so a lost field is visible. */
const invocationUsage: Usage = {
	input: 1200,
	output: 340,
	cacheRead: 38_400,
	cacheWrite: 2800,
	totalTokens: 42_740,
	cost: {
		input: 0.0036,
		output: 0.0051,
		cacheRead: 0.0115,
		cacheWrite: 0.0105,
		total: 0.0307,
	},
};

describe("addInvocationUsage", () => {
	it("accumulates the tokens, the cache tokens, and the cost", () => {
		const once = addInvocationUsage(emptyStepUsage(), invocationUsage);
		const twice = addInvocationUsage(once, invocationUsage);

		expect(twice).toEqual({
			invocations: 2,
			input_tokens: 2400,
			cache_read_tokens: 76_800,
			cache_write_tokens: 5600,
			output_tokens: 680,
			cost: 0.0614,
		});
	});

	it("keeps cacheRead tokens out of input_tokens and never loses them", () => {
		// Regression: the report once summed only `usage.input`, so a review
		// that used prompt caching under-reported its input tokens.
		const usage = addInvocationUsage(emptyStepUsage(), invocationUsage);

		expect(usage.input_tokens).toBe(1200);
		expect(usage.cache_read_tokens).toBe(38_400);
		expect(usage.cache_write_tokens).toBe(2800);
	});
});
