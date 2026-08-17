interface CommandHelp {
	name: string;
	description: string;
}

const COMMANDS: CommandHelp[] = [
	{
		name: "init",
		description: "Create an initial Standards configuration (not implemented)",
	},
	{
		name: "validate",
		description: "Validate the configuration and resolve its rules",
	},
	{
		name: "lock",
		description: "Resolve mutable Git sources and update the lock file",
	},
	{
		name: "review",
		description: "Review changes against the resolved rules (not implemented)",
	},
];

/** Render the top-level CLI help text. */
export function renderHelp(): string {
	const commandWidth = Math.max(...COMMANDS.map(({ name }) => name.length));
	const commandLines = COMMANDS.map(
		({ name, description }) => `  ${name.padEnd(commandWidth)}  ${description}`,
	);

	return [
		"Usage: standards <command>",
		"",
		"Commands:",
		...commandLines,
		"",
		"Options:",
		"  -h, --help  Show this help",
	].join("\n");
}
