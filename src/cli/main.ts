import { CliArgumentError, parseCliArgs } from "./args.js";
import { runInitCommand } from "./commands/init.js";
import { runLockCommand } from "./commands/lock.js";
import { runReviewCommand } from "./commands/review.js";
import { runValidateCommand } from "./commands/validate.js";
import { renderHelp } from "./help.js";
import type { CliOutput } from "./types.js";

/** Run the Standards CLI and return its process exit status. */
export async function runCli(
	arguments_: string[] = process.argv.slice(2),
	workingDirectory = process.cwd(),
	output: CliOutput = console,
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

	const { command, help } = parsedArguments;
	if (command === undefined || help) {
		output.log(renderHelp());
		return 0;
	}

	switch (command) {
		case "init":
			return runInitCommand();
		case "validate":
			return runValidateCommand({ workingDirectory, output });
		case "lock":
			return runLockCommand({ workingDirectory, output });
		case "review":
			return runReviewCommand();
	}
}
