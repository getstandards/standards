import { readFile, realpath } from "node:fs/promises";
import { openRunGitSourceStore } from "../../cache/git-source-cache.js";
import { createImportProgressReporter } from "../../cache/import-progress.js";
import { loadConfiguration } from "../../config/configuration-loader.js";
import type { KnowledgeSource } from "../../config/configuration-schema.js";
import { requirementLevels } from "../../config/configuration-schema.js";
import type { Rule } from "../../rules/rule.js";
import { findEntryFile, loadRules } from "../../rules/rules-loader.js";
import type { CommandContext } from "../cli-context.js";
import { formatValidationError } from "./validate-diagnostic.js";

/** The label that names one knowledge source in the validation output. */
function sourceLabel(source: KnowledgeSource): string {
	if ("repository" in source) {
		const branch = source.branch ?? "default branch";
		const prefix =
			source.id_prefix === undefined ? "" : ` (id_prefix: ${source.id_prefix})`;
		return `${source.repository} at ${branch}${prefix}`;
	}
	const prefix =
		source.id_prefix === undefined ? "" : ` (id_prefix: ${source.id_prefix})`;
	return `${source.path}${prefix}`;
}

/** Render one rule's resolved applies_to scope on one line. */
function formatAppliesTo(appliesTo: Rule["applies_to"]): string {
	const include = appliesTo?.include?.join(", ") ?? "every file";
	const exclude = appliesTo?.exclude;
	return exclude === undefined
		? include
		: `${include} except ${exclude.join(", ")}`;
}

/** Validate and resolve the Standards configuration in the working directory. */
export async function runValidateCommand({
	workingDirectory,
	output,
	environment,
	cacheDir,
	settings,
	noCache,
}: CommandContext): Promise<number> {
	const gitSourceStore = await openRunGitSourceStore({
		cacheDir,
		settingsCacheDir: settings?.cache_dir,
		noCache,
		environment,
		reportCacheFallback: (message) => output.error(message),
	});
	const reportProgress = createImportProgressReporter((line) =>
		output.error(line),
	);
	try {
		const { rules, gitSources, warnings } = await loadRules(workingDirectory, {
			gitSourceStore,
			reportProgress,
		});
		const repositoryRoot = await realpath(workingDirectory);
		// The resolution succeeded, so re-reading the entry file for the source
		// and folder listing cannot fail on the parse.
		const entryFile = await findEntryFile(repositoryRoot);
		const configuration = loadConfiguration(
			await readFile(entryFile.path, "utf8"),
			entryFile.name,
		);
		const levelSummary = requirementLevels
			.map((level) => ({
				level,
				count: rules.filter((rule) => rule.level === level).length,
			}))
			.filter(({ count }) => count > 0)
			.map(({ level, count }) => `${level}: ${count}`)
			.join(", ");

		const lines = [
			"Standards configuration is valid.",
			"",
			`  Repository:     ${repositoryRoot}`,
			`  Entry file:     ${entryFile.name}`,
		];

		if (configuration.sources.length > 0) {
			lines.push("", "Knowledge sources:");
			for (const source of configuration.sources) {
				lines.push(`  ${sourceLabel(source)}`);
				for (const mapping of source.folders) {
					lines.push(`    ${mapping.folder}: ${mapping.level}`);
				}
			}
		}

		if (rules.length > 0) {
			lines.push("", "Rules:");
			const idWidth = Math.max(...rules.map((rule) => rule.id.length));
			for (const rule of rules) {
				lines.push(
					`  ${rule.level.padEnd(6)} ${rule.id.padEnd(idWidth)}  ${formatAppliesTo(rule.applies_to)}`,
				);
			}
		}

		if (gitSources.length > 0) {
			lines.push("", "Git commits:");
			for (const source of gitSources) {
				lines.push(
					`  ${source.repository} at ${source.branch}: ${source.commit}`,
				);
			}
		}

		if (warnings.length > 0) {
			lines.push("", "Warnings:");
			for (const warning of warnings) {
				lines.push(`  ${warning.document}: ${warning.problem}`);
			}
		}

		lines.push(
			"",
			`  Resolved rules: ${rules.length}`,
			`  Levels:         ${levelSummary || "none"}`,
		);
		output.log(lines.join("\n"));
		return 0;
	} catch (error) {
		output.error(await formatValidationError(error, workingDirectory));
		return 1;
	} finally {
		await gitSourceStore.dispose();
	}
}
