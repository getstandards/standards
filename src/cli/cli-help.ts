import { DEFAULT_PROVIDER_MODELS } from "../review/model-selection.js";

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
		description: "Review changes against the resolved rules",
	},
	{
		name: "cache",
		description: "Manage the source cache (clean, prune)",
	},
	{
		name: "schema [config|lock]",
		description: "Print a JSON Schema for the configuration or lock file",
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

const CACHE_SUBCOMMANDS: CommandHelp[] = [
	{
		name: "clean",
		description: "Remove every entry in the source cache",
	},
	{
		name: "prune",
		description: "Remove source cache entries the configuration does not use",
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

const REVIEW_OPTIONS: OptionHelp[] = [
	{ name: "-h, --help", description: "Show this help" },
	{
		name: "--base <revision>",
		description: "Review the change since <revision>",
	},
	{
		name: "--all",
		description: "Review every tracked file of the head revision",
	},
	{
		name: "--format <format>",
		description: "Output format: text (default) or json",
	},
	{
		name: "--model <provider>/<model>",
		description: "Run both agent steps on this model",
	},
	{
		name: "--evaluation-model <provider>/<model>",
		description: "Run the evaluation step on this model",
	},
	{
		name: "--verification-model <provider>/<model>",
		description: "Run the verification step on this model",
	},
	{
		name: "--cache-dir <path>",
		description: "Use <path> as the source cache directory",
	},
	{
		name: "--no-cache",
		description: "Do not read from or write to the source cache",
	},
];

const CACHE_OPTIONS: OptionHelp[] = [
	{ name: "-h, --help", description: "Show this help" },
	{
		name: "--cache-dir <path>",
		description: "Use <path> as the source cache directory",
	},
];

/** Align name and description pairs into padded help lines. */
function formatHelpEntries(entries: CommandHelp[]): string[] {
	const width = Math.max(...entries.map(({ name }) => name.length));
	return entries.map(
		({ name, description }) => `  ${name.padEnd(width)}  ${description}`,
	);
}

/** Render the top-level CLI help text. */
export function renderHelp(): string {
	return [
		"Usage: standards <command>",
		"",
		"Commands:",
		...formatHelpEntries(COMMANDS),
		"",
		"Options:",
		...formatHelpEntries(OPTIONS),
	].join("\n");
}

/** Render the help text for the `standards review` command. */
export function renderReviewHelp(): string {
	const defaultModels = Object.entries(DEFAULT_PROVIDER_MODELS).map(
		([provider, model]) => ({ name: provider, description: model }),
	);
	return [
		"Usage: standards review [options] [target...]",
		"",
		"Review the change between a base revision and HEAD against the resolved",
		"rules. A target limits the review to a file or a directory.",
		"",
		"Options:",
		...formatHelpEntries(REVIEW_OPTIONS),
		"",
		"Default models:",
		...formatHelpEntries(defaultModels),
	].join("\n");
}

/** Render the help text for the `standards cache` command. */
export function renderCacheHelp(): string {
	return [
		"Usage: standards cache <subcommand>",
		"",
		"Subcommands:",
		...formatHelpEntries(CACHE_SUBCOMMANDS),
		"",
		"Options:",
		...formatHelpEntries(CACHE_OPTIONS),
	].join("\n");
}
