import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type {
	AuthEvent,
	AuthInteraction,
	AuthPrompt,
} from "@earendil-works/pi-ai";

/** A sink that drops readline echo so a hidden answer never reaches the terminal. */
function createMutedEcho(): Writable {
	return new Writable({
		write(_chunk, _encoding, callback): void {
			callback();
		},
	});
}

/** One option offered by a `select` login prompt. */
type SelectOption = { id: string; label: string; description?: string };

/**
 * Map a typed answer to a select option id. It accepts the exact option id or
 * a one-based position. It returns undefined when the answer matches neither.
 */
export function resolveSelectAnswer(
	options: readonly SelectOption[],
	answer: string,
): string | undefined {
	const byId = options.find((option) => option.id === answer);
	if (byId !== undefined) {
		return byId.id;
	}
	const position = Number.parseInt(answer, 10);
	if (String(position) === answer) {
		const byPosition = options[position - 1];
		if (byPosition !== undefined) {
			return byPosition.id;
		}
	}
	return undefined;
}

/** Streams and cancellation used by the terminal login interaction. */
export interface TerminalLoginInteractionOptions {
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
	signal?: AbortSignal;
}

/**
 * Build the terminal adapter that a provider login flow drives.
 *
 * It shows every SDK notice (info, authentication URL, device code, and safe
 * progress text) and answers every SDK prompt (text, secret, select, and
 * manual code). A secret or manual-code prompt does not echo the value the
 * user types. An interrupt aborts the pending prompt.
 */
export function createTerminalLoginInteraction(
	options: TerminalLoginInteractionOptions = {},
): AuthInteraction {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;

	function writeLine(line: string): void {
		output.write(`${line}\n`);
	}

	function notify(event: AuthEvent): void {
		switch (event.type) {
			case "info":
				writeLine(event.message);
				for (const link of event.links ?? []) {
					writeLine(
						link.label ? `  ${link.label}: ${link.url}` : `  ${link.url}`,
					);
				}
				return;
			case "auth_url":
				writeLine("Open this URL to continue authentication:");
				writeLine(`  ${event.url}`);
				if (event.instructions !== undefined) {
					writeLine(event.instructions);
				}
				return;
			case "device_code":
				writeLine(`Enter code ${event.userCode} at ${event.verificationUri}`);
				return;
			case "progress":
				writeLine(event.message);
				return;
		}
	}

	function readLine(
		message: string,
		hidden: boolean,
		promptSignal: AbortSignal | undefined,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			// A hidden prompt routes readline echo to a muted sink, so the typed
			// value never shows. Its prompt text is written to the real output.
			const readlineInterface = createInterface({
				input,
				output: hidden ? createMutedEcho() : output,
				terminal: true,
			});
			const signals = [options.signal, promptSignal].filter(
				(signal): signal is AbortSignal => signal !== undefined,
			);

			const onAbort = (): void => {
				readlineInterface.close();
				reject(new Error("Standards login cancelled."));
			};
			for (const signal of signals) {
				if (signal.aborted) {
					onAbort();
					return;
				}
				signal.addEventListener("abort", onAbort, { once: true });
			}

			if (hidden) {
				output.write(`${message} `);
			}
			readlineInterface.question(`${message} `, (answer) => {
				for (const signal of signals) {
					signal.removeEventListener("abort", onAbort);
				}
				readlineInterface.close();
				if (hidden) {
					output.write("\n");
				}
				resolve(answer);
			});
		});
	}

	async function promptSelect(
		prompt: Extract<AuthPrompt, { type: "select" }>,
	): Promise<string> {
		writeLine(prompt.message);
		prompt.options.forEach((option, index) => {
			const suffix =
				option.description === undefined ? "" : ` (${option.description})`;
			writeLine(`  ${index + 1}) ${option.label}${suffix}`);
		});
		for (;;) {
			const answer = (
				await readLine("Enter a number or id:", false, prompt.signal)
			).trim();
			const id = resolveSelectAnswer(prompt.options, answer);
			if (id !== undefined) {
				return id;
			}
			writeLine(`Unknown selection '${answer}'. Please try again.`);
		}
	}

	async function prompt(request: AuthPrompt): Promise<string> {
		if (request.type === "select") {
			return promptSelect(request);
		}
		const hidden = request.type === "secret" || request.type === "manual_code";
		return readLine(request.message, hidden, request.signal);
	}

	return { signal: options.signal, prompt, notify };
}
