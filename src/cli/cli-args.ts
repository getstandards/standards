import { parseArgs } from "node:util";
import { z } from "zod/v4";
import { errorMessage } from "../utils/errors.js";

export const cliCommandSchema = z.enum(["init", "validate", "lock", "review"]);

export type CliCommand = z.infer<typeof cliCommandSchema>;

/** Validated Standards CLI arguments. */
export interface ParsedCliArgs {
	command?: CliCommand;
	help: boolean;
}

/** An invalid CLI command, argument, or option. */
export class CliArgumentError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "CliArgumentError";
	}
}

/** Parse and validate Standards CLI arguments. */
export function parseCliArgs(
	arguments_: string[] = process.argv.slice(2),
): ParsedCliArgs {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: arguments_,
			options: {
				help: { type: "boolean", short: "h", default: false },
			},
			allowPositionals: true,
			strict: true,
		});
	} catch (error) {
		throw new CliArgumentError(errorMessage(error));
	}

	const [command, ...commandArguments] = parsed.positionals;
	if (command === undefined) {
		return { help: Boolean(parsed.values.help) };
	}

	const commandResult = cliCommandSchema.safeParse(command);
	if (!commandResult.success) {
		throw new CliArgumentError(`Unknown command '${command}'.`);
	}

	if (commandArguments.length > 0 || parsed.values.help) {
		throw new CliArgumentError(
			`Command '${command}' does not accept arguments or options.`,
		);
	}

	return { command: commandResult.data, help: false };
}
