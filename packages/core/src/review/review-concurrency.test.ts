import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONCURRENCY,
	mapWithConcurrency,
	ReviewConcurrencyError,
	resolveConcurrency,
} from "./review-concurrency.js";

/** A call that resolves only when the test releases it. */
function deferred(): { promise: Promise<void>; release: () => void } {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

describe("resolveConcurrency", () => {
	it("prefers the option, then the environment, then the settings", () => {
		const environment = { STANDARDS_CONCURRENCY: "8" };
		const settings = { version: 1, concurrency: 2 } as const;

		expect(resolveConcurrency({ option: 3, environment, settings })).toBe(3);
		expect(resolveConcurrency({ environment, settings })).toBe(8);
		expect(resolveConcurrency({ environment: {}, settings })).toBe(2);
		expect(resolveConcurrency({ environment: {} })).toBe(DEFAULT_CONCURRENCY);
	});

	it("fails on an invalid source instead of reading the next one", () => {
		const settings = { version: 1, concurrency: 2 } as const;

		expect(() =>
			resolveConcurrency({
				environment: { STANDARDS_CONCURRENCY: "0" },
				settings,
			}),
		).toThrow(ReviewConcurrencyError);
		expect(() =>
			resolveConcurrency({
				environment: { STANDARDS_CONCURRENCY: "many" },
				settings,
			}),
		).toThrow(/STANDARDS_CONCURRENCY environment variable.*'many'/s);
		expect(() =>
			resolveConcurrency({ option: 1.5, environment: {}, settings }),
		).toThrow(/concurrency option.*'1.5'/s);
	});

	it("reads an empty environment variable as unset", () => {
		expect(
			resolveConcurrency({ environment: { STANDARDS_CONCURRENCY: "" } }),
		).toBe(DEFAULT_CONCURRENCY);
	});
});

describe("mapWithConcurrency", () => {
	it("never runs more calls at the same time than the limit", async () => {
		const gates = [deferred(), deferred(), deferred(), deferred()];
		let running = 0;
		let peak = 0;

		const mapped = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
			running += 1;
			peak = Math.max(peak, running);
			await gates[item]?.promise;
			running -= 1;
			return item * 2;
		});

		for (const gate of gates) {
			// Release one call per turn, so a free slot can start a waiting call.
			gate.release();
			await Promise.resolve();
		}

		expect(await mapped).toEqual([0, 2, 4, 6]);
		expect(peak).toBe(2);
	});

	it("returns the results in item order, not in completion order", async () => {
		const results = await mapWithConcurrency(
			["slow", "fast"],
			2,
			async (item) => {
				if (item === "fast") {
					return item;
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
				return item;
			},
		);

		expect(results).toEqual(["slow", "fast"]);
	});

	it("starts no waiting call after a failure and rethrows the first error", async () => {
		const started: number[] = [];

		await expect(
			mapWithConcurrency([0, 1, 2, 3], 1, async (item) => {
				started.push(item);
				if (item === 1) {
					throw new Error("provider failed");
				}
				return item;
			}),
		).rejects.toThrow("provider failed");
		expect(started).toEqual([0, 1]);
	});
});
