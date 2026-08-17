/** Output streams used by the CLI. */
export interface CliOutput {
	log(message: string): void;
	error(message: string): void;
}

/** Runtime values available to a CLI command. */
export interface CommandContext {
	workingDirectory: string;
	output: CliOutput;
}
