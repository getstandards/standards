import { parseArgs } from "node:util";
import {
	errorMessage,
	parseConcurrencyLimit,
} from "@getstandards/core/internal";
import { z } from "zod/v4";
import { renderCommandHelp } from "./cli-help.js";

export const cliCommandSchema = z.enum([
	"init",
	"validate",
	"review",
	"cache",
	"auth",
	"models",
]);

export type CliCommand = z.infer<typeof cliCommandSchema>;

export const cacheSubcommandSchema = z.enum(["clean", "prune"]);

export type CacheSubcommand = z.infer<typeof cacheSubcommandSchema>;

export const authSubcommandSchema = z.enum(["login", "logout", "status"]);

export type AuthSubcommand = z.infer<typeof authSubcommandSchema>;

export const reviewFormatSchema = z.enum(["text", "json"]);

export type ReviewFormat = z.infer<typeof reviewFormatSchema>;

/** Review is a checking command, so its errors exit with status 2 (specs/cli.md). */
const REVIEW_ERROR_STATUS = 2;

/** Commands that read from or write to the persistent source cache. */
const CACHE_AWARE_COMMANDS: CliCommand[] = ["validate", "review"];

/** The `auth` subcommands that take one optional model provider argument. */
const PROVIDER_AUTH_SUBCOMMANDS: AuthSubcommand[] = ["login", "logout"];

/** Validated arguments and options of the `standards models` command. */
export interface ModelsCliArgs {
	/** Scope the listing to this provider id, credentialed or not. */
	provider?: string;
	/** List every known provider and every model id, without the alias filter. */
	all: boolean;
}

/** Validated arguments and options of the `standards review` command. */
export interface ReviewCliArgs {
	/** Repository-relative file or directory paths that limit the review. */
	targets: string[];
	base?: string;
	/** A `<base>..<head>` or `<base>...<head>` Git commit range. */
	range?: string;
	staged: boolean;
	all: boolean;
	/** Limit the rule set to the rule with this exact id. */
	rule?: string;
	/** Limit the rule set to the rules of this mapped folder. */
	folder?: string;
	format: ReviewFormat;
	model?: string;
	evaluationModel?: string;
	verificationModel?: string;
	/** The concurrency limit of the review (specs/concurrency.md). */
	concurrency?: number;
	verbose: boolean;
}

/** Validated Standards CLI arguments. */
export interface ParsedCliArgs {
	command?: CliCommand;
	cacheSubcommand?: CacheSubcommand;
	authSubcommand?: AuthSubcommand;
	provider?: string;
	review?: ReviewCliArgs;
	models?: ModelsCliArgs;
	cacheDir?: string;
	noCache: boolean;
	help: boolean;
	version?: boolean;
}

/** An invalid CLI command, argument, or option. */
export class CliArgumentError extends Error {
	public constructor(
		message: string,
		/** The exit status of the command whose arguments are invalid. */
		public readonly exitStatus: number = 1,
	) {
		super(message);
		this.name = "CliArgumentError";
	}
}

/** Return the error exit status for the command the arguments name. */
function argumentErrorStatus(arguments_: readonly string[]): number {
	const command = arguments_.find((argument) => !argument.startsWith("-"));
	return command === "review" ? REVIEW_ERROR_STATUS : 1;
}

/** Parse raw CLI arguments with Node and convert its errors to CLI diagnostics. */
function parseRawCliArguments(arguments_: readonly string[]) {
	try {
		return parseArgs({
			args: arguments_,
			options: {
				help: { type: "boolean", short: "h", default: false },
				version: { type: "boolean", default: false },
				"cache-dir": { type: "string" },
				"no-cache": { type: "boolean", default: false },
				base: { type: "string" },
				range: { type: "string" },
				staged: { type: "boolean", default: false },
				all: { type: "boolean", default: false },
				rule: { type: "string" },
				folder: { type: "string" },
				verbose: { type: "boolean", default: false },
				format: { type: "string" },
				model: { type: "string" },
				"evaluation-model": { type: "string" },
				"verification-model": { type: "string" },
				concurrency: { type: "string" },
			},
			allowPositionals: true,
			strict: true,
		});
	} catch (error) {
		throw new CliArgumentError(
			errorMessage(error),
			argumentErrorStatus(arguments_),
		);
	}
}

/** Parse and validate Standards CLI arguments. */
export function parseCliArgs(
	arguments_: string[] = process.argv.slice(2),
): ParsedCliArgs {
	const parsed = parseRawCliArguments(arguments_);
	const help = Boolean(parsed.values.help);
	const version = Boolean(parsed.values.version);
	const noCache = Boolean(parsed.values["no-cache"]);
	const cacheDir = parsed.values["cache-dir"];
	const [command, ...commandArguments] = parsed.positionals;

	if (version) {
		if (command !== undefined) {
			throw new CliArgumentError(
				`Command '${command}' does not accept the '--version' option.`,
				argumentErrorStatus(arguments_),
			);
		}
		return { help: false, noCache, cacheDir, version: true };
	}

	if (command === undefined) {
		return { help, noCache, cacheDir };
	}

	const commandResult = cliCommandSchema.safeParse(command);
	if (!commandResult.success) {
		throw new CliArgumentError(`Unknown command '${command}'.`);
	}
	const parsedCommand = commandResult.data;
	const reviewValues: ReviewOptionValues = {
		base: parsed.values.base,
		range: parsed.values.range,
		staged: Boolean(parsed.values.staged),
		all: Boolean(parsed.values.all),
		rule: parsed.values.rule,
		folder: parsed.values.folder,
		verbose: Boolean(parsed.values.verbose),
		format: parsed.values.format,
		model: parsed.values.model,
		evaluationModel: parsed.values["evaluation-model"],
		verificationModel: parsed.values["verification-model"],
		concurrency: parsed.values.concurrency,
	};

	if (help) {
		// A command accepts '--help' exactly when it has a help text to print.
		if (renderCommandHelp(parsedCommand) === undefined) {
			throw new CliArgumentError(
				`Command '${parsedCommand}' does not accept the '--help' option.`,
			);
		}
		return { command: parsedCommand, cacheDir, noCache: false, help: true };
	}

	if (parsedCommand === "review") {
		return parseReviewCommand(
			commandArguments,
			reviewValues,
			cacheDir,
			noCache,
		);
	}

	if (parsedCommand === "models") {
		rejectReviewOnlyOptions(parsedCommand, reviewValues, ["--all"]);
		return parseModelsCommand(
			commandArguments,
			reviewValues.all,
			cacheDir,
			noCache,
		);
	}
	rejectReviewOnlyOptions(parsedCommand, reviewValues);

	if (parsedCommand === "cache") {
		return parseCacheCommand(commandArguments, cacheDir, noCache);
	}

	if (parsedCommand === "auth") {
		return parseAuthCommand(commandArguments, cacheDir, noCache);
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

/** The raw review option values read from the parsed arguments. */
interface ReviewOptionValues {
	base?: string;
	range?: string;
	staged: boolean;
	all: boolean;
	rule?: string;
	folder?: string;
	verbose: boolean;
	format?: string;
	model?: string;
	evaluationModel?: string;
	verificationModel?: string;
	concurrency?: string;
}

/**
 * Reject the options that only the `review` command accepts.
 *
 * `accepted` names the review options that this command shares with `review`;
 * `models` shares `--all`.
 */
function rejectReviewOnlyOptions(
	command: CliCommand,
	values: ReviewOptionValues,
	accepted: readonly string[] = [],
): void {
	const givenOptions: [string, boolean][] = [
		["--base", values.base !== undefined],
		["--range", values.range !== undefined],
		["--staged", values.staged],
		["--all", values.all],
		["--rule", values.rule !== undefined],
		["--folder", values.folder !== undefined],
		["--verbose", values.verbose],
		["--format", values.format !== undefined],
		["--model", values.model !== undefined],
		["--evaluation-model", values.evaluationModel !== undefined],
		["--verification-model", values.verificationModel !== undefined],
		["--concurrency", values.concurrency !== undefined],
	];
	const given = givenOptions.find(
		([name, isGiven]) => isGiven && !accepted.includes(name),
	);
	if (given !== undefined) {
		throw new CliArgumentError(
			`Command '${command}' does not accept the '${given[0]}' option.`,
		);
	}
}

/** Parse the arguments and options of the `review` command (specs/cli.md). */
function parseReviewCommand(
	targets: string[],
	values: ReviewOptionValues,
	cacheDir: string | undefined,
	noCache: boolean,
): ParsedCliArgs {
	// The scope options each select the whole change, so they cannot combine.
	const givenScopeOptions = (
		[
			["--all", values.all],
			["--base", values.base !== undefined],
			["--range", values.range !== undefined],
			["--staged", values.staged],
		] as const
	)
		.filter(([, isGiven]) => isGiven)
		.map(([name]) => name);
	if (givenScopeOptions.length > 1) {
		throw new CliArgumentError(
			`Command 'review' does not accept '${givenScopeOptions[0]}' and '${givenScopeOptions[1]}' together.`,
			REVIEW_ERROR_STATUS,
		);
	}
	if (values.rule !== undefined && values.folder !== undefined) {
		throw new CliArgumentError(
			"Command 'review' does not accept '--rule' and '--folder' together: '--rule' already names one rule.",
			REVIEW_ERROR_STATUS,
		);
	}
	const formatResult = reviewFormatSchema.safeParse(values.format ?? "text");
	if (!formatResult.success) {
		throw new CliArgumentError(
			`Option '--format' expects 'text' or 'json', not '${values.format}'.`,
			REVIEW_ERROR_STATUS,
		);
	}
	const concurrency =
		values.concurrency === undefined
			? undefined
			: parseConcurrencyLimit(values.concurrency);
	if (values.concurrency !== undefined && concurrency === undefined) {
		throw new CliArgumentError(
			`Option '--concurrency' expects an integer greater than or equal to 1, not '${values.concurrency}'.`,
			REVIEW_ERROR_STATUS,
		);
	}
	return {
		command: "review",
		review: {
			targets,
			base: values.base,
			range: values.range,
			staged: values.staged,
			all: values.all,
			rule: values.rule,
			folder: values.folder,
			format: formatResult.data,
			model: values.model,
			evaluationModel: values.evaluationModel,
			verificationModel: values.verificationModel,
			concurrency,
			verbose: values.verbose,
		},
		cacheDir,
		noCache,
		help: false,
	};
}

/** Reject the source cache options on a command that never reads the cache. */
function rejectCacheOptions(
	command: string,
	cacheDir: string | undefined,
	noCache: boolean,
): void {
	if (cacheDir !== undefined) {
		throw new CliArgumentError(
			`Command '${command}' does not accept the '--cache-dir' option.`,
		);
	}
	if (noCache) {
		throw new CliArgumentError(
			`Command '${command}' does not accept the '--no-cache' option.`,
		);
	}
}

/** Parse the subcommand and provider of the `auth` command group (specs/cli.md auth). */
function parseAuthCommand(
	commandArguments: string[],
	cacheDir: string | undefined,
	noCache: boolean,
): ParsedCliArgs {
	rejectCacheOptions("auth", cacheDir, noCache);

	const [subcommand, provider, ...rest] = commandArguments;
	if (subcommand === undefined) {
		return { command: "auth", noCache: false, help: false };
	}

	const subcommandResult = authSubcommandSchema.safeParse(subcommand);
	if (!subcommandResult.success) {
		throw new CliArgumentError(`Unknown command 'auth ${subcommand}'.`);
	}
	const parsedSubcommand = subcommandResult.data;

	if (PROVIDER_AUTH_SUBCOMMANDS.includes(parsedSubcommand)) {
		if (rest.length > 0) {
			throw new CliArgumentError(
				`Command 'auth ${parsedSubcommand}' accepts at most one provider argument.`,
			);
		}
	} else if (provider !== undefined) {
		throw new CliArgumentError(
			`Command 'auth ${parsedSubcommand}' does not accept arguments or options.`,
		);
	}

	return {
		command: "auth",
		authSubcommand: parsedSubcommand,
		provider,
		noCache: false,
		help: false,
	};
}

/** Parse the provider argument and `--all` option of the `models` command. */
function parseModelsCommand(
	commandArguments: string[],
	all: boolean,
	cacheDir: string | undefined,
	noCache: boolean,
): ParsedCliArgs {
	rejectCacheOptions("models", cacheDir, noCache);

	const [provider, ...rest] = commandArguments;
	if (rest.length > 0) {
		throw new CliArgumentError(
			"Command 'models' accepts at most one provider argument.",
		);
	}

	return {
		command: "models",
		models: { provider, all },
		noCache: false,
		help: false,
	};
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
