import type { StandardsSettings } from "../settings/settings-schema.js";
import { nonEmptyEnvironmentValue } from "../utils/environment.js";

/** The concurrency limit a review uses when no source sets one. */
export const DEFAULT_CONCURRENCY = 4;

/** An invalid concurrency limit, with a human-actionable diagnostic. */
export class ReviewConcurrencyError extends Error {
	public constructor(public readonly diagnostic: string) {
		super(diagnostic);
		this.name = "ReviewConcurrencyError";
	}
}

/** Everything the concurrency limit reads to resolve its value. */
export interface ConcurrencyInputs {
	/** The value of the `--concurrency` option, or the equivalent surface input. */
	option?: number;
	environment: NodeJS.ProcessEnv;
	settings?: StandardsSettings;
}

/**
 * Resolve the concurrency limit of one review (specs/concurrency.md).
 *
 * The first source that is set wins: the surface option, the
 * STANDARDS_CONCURRENCY environment variable, the `concurrency` settings
 * field, then the default. A source that holds an invalid value throws
 * instead of falling through, so a review never runs on a limit the user did
 * not set. The settings field is already an integer of at least 1: its schema
 * validates it when the settings file loads.
 */
export function resolveConcurrency(inputs: ConcurrencyInputs): number {
	if (inputs.option !== undefined) {
		if (!Number.isInteger(inputs.option) || inputs.option < 1) {
			throw concurrencyError("The concurrency option", String(inputs.option));
		}
		return inputs.option;
	}
	const fromEnvironment = nonEmptyEnvironmentValue(
		inputs.environment.STANDARDS_CONCURRENCY,
	);
	if (fromEnvironment !== undefined) {
		const limit = parseConcurrencyLimit(fromEnvironment);
		if (limit === undefined) {
			throw concurrencyError(
				"The STANDARDS_CONCURRENCY environment variable",
				fromEnvironment,
			);
		}
		return limit;
	}
	return inputs.settings?.concurrency ?? DEFAULT_CONCURRENCY;
}

/**
 * Read a concurrency limit written as text.
 *
 * It returns undefined when the text is not an integer greater than or equal
 * to 1, so every surface that reads the limit from text shares one value rule.
 */
export function parseConcurrencyLimit(value: string): number | undefined {
	const text = value.trim();
	if (!/^\d+$/.test(text)) {
		return undefined;
	}
	const limit = Number(text);
	return limit >= 1 ? limit : undefined;
}

/** Build the failure that names the source and the value it holds. */
function concurrencyError(
	source: string,
	value: string,
): ReviewConcurrencyError {
	return new ReviewConcurrencyError(
		`Standards review could not set the concurrency limit.

Problem:
  ${source} is not an integer greater than or equal to 1: '${value}'.

Next action:
  Set it to an integer greater than or equal to 1, such as ${DEFAULT_CONCURRENCY}.`,
	);
}

/**
 * Run one asynchronous call per item, at most `limit` at the same time
 * (specs/concurrency.md).
 *
 * It returns the results in item order, not in completion order, so the limit
 * schedules the work without changing the review report. After a call
 * rejects, no waiting item starts; the calls already in flight run to
 * completion, then the first error is rethrown.
 */
export async function mapWithConcurrency<Item, Result>(
	items: readonly Item[],
	limit: number,
	run: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
	const results = new Array<Result>(items.length);
	// One shared iterator hands the next item to whichever worker is free.
	const queue = items.entries();
	let failure: { error: unknown } | undefined;

	async function worker(): Promise<void> {
		while (failure === undefined) {
			const next = queue.next();
			if (next.done === true) {
				return;
			}
			const [index, item] = next.value;
			try {
				results[index] = await run(item, index);
			} catch (error) {
				failure ??= { error };
			}
		}
	}

	const workers = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workers }, () => worker()));
	if (failure !== undefined) {
		throw failure.error;
	}
	return results;
}
