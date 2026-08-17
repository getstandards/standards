import { parseArgs } from "node:util";
import { z } from "zod/v4";
import { errorMessage } from "../utils/errors.js";

export const cliCommandSchema = z.enum([
	"init",
	"validate",
	"lock",
	"review",
	"cache",
]);

export type CliCommand = z.infer<typeof cliCommandSchema>;

export const cacheSubcommandSchema = z.enum(["clean", "prune"]);

export type CacheSubcommand = z.infer<typeof cacheSubcommandSchema>;

/** Commands that read from or write to the persistent source cache. */
const CACHE_AWARE_COMMANDS: CliCommand[] = ["validate", "lock", "review"];

/** Validated Standards CLI arguments. */
export interface ParsedCliArgs {
	command?: CliCommand;
	cacheSubcommand?: CacheSubcommand;
	cacheDir?: string;
	noCache: boolean;
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
				"cache-dir": { type: "string" },
				"no-cache": { type: "boolean", default: false },
			},
			allowPositionals: true,
			strict: true,
		});
	} catch (error) {
		throw new CliArgumentError(errorMessage(error));
	}

	const help = Boolean(parsed.values.help);
	const noCache = Boolean(parsed.values["no-cache"]);
	const cacheDir = parsed.values["cache-dir"] as string | undefined;
	const [command, ...commandArguments] = parsed.positionals;

	if (command === undefined) {
		return { help, noCache, cacheDir };
	}

	const commandResult = cliCommandSchema.safeParse(command);
	if (!commandResult.success) {
		throw new CliArgumentError(`Unknown command '${command}'.`);
	}
	const parsedCommand = commandResult.data;

	if (help) {
		throw new CliArgumentError(
			`Command '${parsedCommand}' does not accept the '--help' option.`,
		);
	}

	if (parsedCommand === "cache") {
		return parseCacheCommand(commandArguments, cacheDir, noCache);
	}

	if (commandArguments.length > 0) {
		throw new CliArgumentError(
			`Command '${parsedCommand}' does not accept arguments or options.`,
		);
	}

	if (!CACHE_AWARE_COMMANDS.includes(parsedCommand)) {
		if (cacheDir !== undefined) {
			throw new CliArgumentError(
				`Command '${parsedCommand}' does not accept the '--cache-dir' option.`,
			);
		}
		if (noCache) {
			throw new CliArgumentError(
				`Command '${parsedCommand}' does not accept the '--no-cache' option.`,
			);
		}
	}

	return { command: parsedCommand, cacheDir, noCache, help: false };
}

/** Parse the arguments and options of the `cache` command. */
function parseCacheCommand(
	commandArguments: string[],
	cacheDir: string | undefined,
	noCache: boolean,
): ParsedCliArgs {
	if (noCache) {
		throw new CliArgumentError(
			"Command 'cache' does not accept the '--no-cache' option.",
		);
	}

	const [subcommand, ...rest] = commandArguments;
	if (subcommand === undefined) {
		return { command: "cache", cacheDir, noCache: false, help: false };
	}

	const subcommandResult = cacheSubcommandSchema.safeParse(subcommand);
	if (!subcommandResult.success) {
		throw new CliArgumentError(`Unknown command 'cache ${subcommand}'.`);
	}

	if (rest.length > 0) {
		throw new CliArgumentError(
			`Command 'cache ${subcommand}' does not accept extra arguments.`,
		);
	}

	return {
		command: "cache",
		cacheSubcommand: subcommandResult.data,
		cacheDir,
		noCache: false,
		help: false,
	};
}
