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
	{
		name: "cache clean",
		description: "Remove every entry in the source cache",
	},
	{
		name: "cache prune",
		description: "Remove source cache entries the configuration does not use",
	},
	{
		name: "login <provider>",
		description: "Store a model provider credential",
	},
	{
		name: "logout <provider>",
		description: "Remove a stored model provider credential",
	},
];

interface OptionHelp {
	name: string;
	description: string;
}

const OPTIONS: OptionHelp[] = [
	{ name: "-h, --help", description: "Show this help" },
	{
		name: "--cache-dir <path>",
		description: "Use <path> as the source cache directory",
	},
	{
		name: "--no-cache",
		description: "Do not read from or write to the source cache",
	},
];

/** Render the top-level CLI help text. */
export function renderHelp(): string {
	const commandWidth = Math.max(...COMMANDS.map(({ name }) => name.length));
	const commandLines = COMMANDS.map(
		({ name, description }) => `  ${name.padEnd(commandWidth)}  ${description}`,
	);

	const optionWidth = Math.max(...OPTIONS.map(({ name }) => name.length));
	const optionLines = OPTIONS.map(
		({ name, description }) => `  ${name.padEnd(optionWidth)}  ${description}`,
	);

	return [
		"Usage: standards <command>",
		"",
		"Commands:",
		...commandLines,
		"",
		"Options:",
		...optionLines,
	].join("\n");
}
