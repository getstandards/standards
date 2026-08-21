import { formatStandardsSettingsDiagnostic } from "../settings/settings-diagnostic.js";
import { resolveStandardsSettingsPath } from "../settings/settings-file-location.js";
import {
	readStandardsSettingsFile,
	StandardsSettingsLoadError,
} from "../settings/settings-loader.js";
import type { StandardsSettings } from "../settings/settings-schema.js";
import { CliArgumentError, parseCliArgs } from "./cli-args.js";
import type { CliOutput, CommandContext } from "./cli-context.js";
import { renderCacheHelp, renderHelp, renderReviewHelp } from "./cli-help.js";
import { runCacheCommand } from "./commands/cache.js";
import { runInitCommand } from "./commands/init.js";
import { runLockCommand } from "./commands/lock.js";
import { runLoginCommand } from "./commands/login.js";
import { runLogoutCommand } from "./commands/logout.js";
import { runReviewCommand } from "./commands/review.js";
import { runSchemaCommand } from "./commands/schema.js";
import { runValidateCommand } from "./commands/validate.js";
import { VERSION } from "./version.js";

/** Run the Standards CLI and return its process exit status. */
export async function runCli(
	arguments_: string[] = process.argv.slice(2),
	workingDirectory = process.cwd(),
	output: CliOutput = console,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
	let parsedArguments: ReturnType<typeof parseCliArgs>;
	try {
		parsedArguments = parseCliArgs(arguments_);
	} catch (error) {
		const message =
			error instanceof CliArgumentError ? error.message : String(error);
		output.error(`${message}\n\n${renderHelp()}`);
		return error instanceof CliArgumentError ? error.exitStatus : 1;
	}

	const {
		command,
		cacheSubcommand,
		schemaTarget,
		provider,
		review,
		cacheDir,
		noCache,
		help,
		version,
	} = parsedArguments;
	if (version) {
		output.log(VERSION);
		return 0;
	}
	if (command === undefined) {
		output.log(renderHelp());
		return 0;
	}
	if (help) {
		output.log(command === "review" ? renderReviewHelp() : renderCacheHelp());
		return 0;
	}

	// A broken settings file fails every command that can use a settings
	// value, even when an option or environment variable overrides the value
	// it holds. One rule keeps runs predictable (specs/settings.md).
	const commandReadsSettings =
		command === "validate" ||
		command === "lock" ||
		command === "review" ||
		(command === "cache" && cacheSubcommand !== undefined);

	let settings: StandardsSettings | undefined;
	if (commandReadsSettings) {
		try {
			settings = await readStandardsSettingsFile(
				resolveStandardsSettingsPath({ environment }),
			);
		} catch (error) {
			if (!(error instanceof StandardsSettingsLoadError)) {
				throw error;
			}
			output.error(formatStandardsSettingsDiagnostic(error));
			// Review is a checking command: it exits with status 2 when it
			// could not run (specs/cli.md exit statuses).
			return command === "review" ? 2 : 1;
		}
	}

	const context: CommandContext = {
		workingDirectory,
		output,
		environment,
		cacheDir,
		settings,
		noCache,
		interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
	};

	switch (command) {
		case "init":
			return runInitCommand(context);
		case "validate":
			return runValidateCommand(context);
		case "lock":
			return runLockCommand(context);
		case "review":
			return runReviewCommand(
				context,
				review ?? { targets: [], all: false, format: "text", verbose: false },
			);
		case "cache":
			return runCacheCommand(context, cacheSubcommand);
		case "schema":
			return runSchemaCommand(context, schemaTarget);
		case "login":
			return runLoginCommand(context, provider);
		case "logout":
			return runLogoutCommand(context, provider);
	}
}
