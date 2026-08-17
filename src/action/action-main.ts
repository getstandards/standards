import { runAction } from "./action-runner.js";

try {
	await runAction();
} catch (error) {
	const message = error instanceof Error ? error.message : "Action failed.";
	console.error(`::error::${message}`);
	process.exitCode = 1;
}
