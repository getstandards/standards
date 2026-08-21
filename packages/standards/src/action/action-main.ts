import { runAction } from "./action-run.js";

try {
	process.exitCode = await runAction();
} catch (error) {
	// A failure before the check run exists: print the diagnostic and exit
	// with status 2, the run that could not complete (specs/github.md).
	const message = error instanceof Error ? error.message : "Action failed.";
	console.error(`::error::${message.split("\n")[0]}`);
	console.error(message);
	process.exitCode = 2;
}
