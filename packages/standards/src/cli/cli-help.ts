import { DEFAULT_PROVIDER_MODELS } from "@getstandards/core";
import { renderBanner } from "./banner.js";
import type { CliCommand } from "./cli-args.js";

interface CommandHelp {
	name: string;
	description: string;
}

const COMMANDS: CommandHelp[] = [
	{
		name: "init",
		description: "Create an initial Standards configuration",
	},
	{
		name: "validate",
		description: "Validate the configuration and resolve its rules",
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
		name: "auth",
		description: "Manage model provider credentials (login, logout, status)",
	},
	{
		name: "models [provider]",
		description: "List the model references the credentials make usable",
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

const AUTH_SUBCOMMANDS: CommandHelp[] = [
	{
		name: "login <provider>",
		description: "Store a model provider credential",
	},
	{
		name: "logout <provider>",
		description: "Remove a stored model provider credential",
	},
	{
		name: "status",
		description: "Report which providers have a usable credential",
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
		description: "Review the working tree against <revision>",
	},
	{
		name: "--range <base>..<head>",
		description: "Review a commit range",
	},
	{
		name: "--staged",
		description: "Review only the staged changes",
	},
	{
		name: "--all",
		description: "Review every file of the working tree",
	},
	{
		name: "--rule <id>",
		description: "Limit the review to the rule with this id",
	},
	{
		name: "--folder <folder>",
		description: "Limit the review to the rules of this mapped folder",
	},
	{
		name: "--format <format>",
		description: "Output format: text (default) or json",
	},
	{
		name: "--verbose",
		description: "Print detailed review progress to standard error",
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
		name: "--concurrency <n>",
		description: "Run at most <n> agent invocations at the same time",
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

/** One example invocation of `standards review` and what it reviews. */
const REVIEW_EXAMPLES: CommandHelp[] = [
	{
		name: "standards review",
		description: "Review the uncommitted work on this branch",
	},
	{
		name: "standards review --staged",
		description: "Review only the staged changes",
	},
	{
		name: "standards review --range main..HEAD",
		description: "Review a commit range",
	},
	{
		name: "standards review src/billing",
		description: "Review the change under one directory",
	},
	{
		name: "standards review --all --rule <id>",
		description: "Check every file against one rule",
	},
];

const CACHE_OPTIONS: OptionHelp[] = [
	{ name: "-h, --help", description: "Show this help" },
	{
		name: "--cache-dir <path>",
		description: "Use <path> as the source cache directory",
	},
];

const AUTH_OPTIONS: OptionHelp[] = [
	{ name: "-h, --help", description: "Show this help" },
];

const MODELS_OPTIONS: OptionHelp[] = [
	{ name: "-h, --help", description: "Show this help" },
	{
		name: "--all",
		description: "List every known provider and every model id",
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
		renderBanner(),
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
		"Review a change against the resolved rules. Without a scope option, the",
		"change is the working tree against the merge base of HEAD and the remote",
		"default branch, so uncommitted work is reviewed. A target limits the",
		"review to a file or a directory.",
		"",
		"Options:",
		...formatHelpEntries(REVIEW_OPTIONS),
		"",
		"Examples:",
		...formatHelpEntries(REVIEW_EXAMPLES),
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

/** Render the help text for the `standards auth` command group. */
export function renderAuthHelp(): string {
	return [
		"Usage: standards auth <subcommand>",
		"",
		"Manage the model provider credentials that a review uses. A credential",
		"is stored per provider; 'standards models' lists what it makes usable.",
		"",
		"Subcommands:",
		...formatHelpEntries(AUTH_SUBCOMMANDS),
		"",
		"Options:",
		...formatHelpEntries(AUTH_OPTIONS),
	].join("\n");
}

/** Render the help text for the `standards models` command. */
export function renderModelsHelp(): string {
	return [
		"Usage: standards models [options] [provider]",
		"",
		"List model references, grouped by provider. Every model line is a",
		"complete '<provider>/<model>' reference that '--model' accepts. Only the",
		"providers with a usable credential are listed unless '--all' is given.",
		"",
		"Options:",
		...formatHelpEntries(MODELS_OPTIONS),
	].join("\n");
}

/**
 * Render the help text of one command, or undefined when it has none.
 *
 * This is also the list of commands that accept '--help': a command accepts
 * the option exactly when it has a help text to print.
 */
export function renderCommandHelp(command: CliCommand): string | undefined {
	switch (command) {
		case "review":
			return renderReviewHelp();
		case "cache":
			return renderCacheHelp();
		case "auth":
			return renderAuthHelp();
		case "models":
			return renderModelsHelp();
		default:
			return undefined;
	}
}
