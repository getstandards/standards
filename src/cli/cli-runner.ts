import { CliArgumentError, parseCliArgs } from "./cli-args.js";
import type { CliOutput, CommandContext } from "./cli-context.js";
import { renderHelp } from "./cli-help.js";
import { runCacheCommand } from "./commands/cache.js";
import { runInitCommand } from "./commands/init.js";
import { runLockCommand } from "./commands/lock.js";
import { runReviewCommand } from "./commands/review.js";
import { runValidateCommand } from "./commands/validate.js";

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
		return 1;
	}

	const { command, cacheSubcommand, cacheDir, noCache, help } = parsedArguments;
	if (command === undefined || help) {
		output.log(renderHelp());
		return 0;
	}

	const context: CommandContext = {
		workingDirectory,
		output,
		environment,
		cacheDir,
		noCache,
	};

	switch (command) {
		case "init":
			return runInitCommand();
		case "validate":
			return runValidateCommand(context);
		case "lock":
			return runLockCommand(context);
		case "review":
			return runReviewCommand();
		case "cache":
			return runCacheCommand(context, cacheSubcommand);
	}
}
