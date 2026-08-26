import { realpath } from "node:fs/promises";
import { openRunGitSourceStore } from "../../cache/git-source-cache.js";
import { createImportProgressReporter } from "../../cache/import-progress.js";
import { requirementLevels } from "../../config/configuration-schema.js";
import { loadRules } from "../../rules/rules-loader.js";
import type { CommandContext } from "../cli-context.js";
import { formatValidationError } from "./validate-diagnostic.js";

const ENTRY_FILE_NAME = ".standards.yml";

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
			`  Entry file:     ${ENTRY_FILE_NAME}`,
			`  Resolved rules: ${rules.length}`,
			`  Levels:         ${levelSummary || "none"}`,
		];
		for (const source of gitSources) {
			lines.push(
				`  Git source:     ${source.repository} at ${source.ref}: ${source.commit}`,
			);
		}
		if (warnings.length > 0) {
			lines.push("", "Warnings:");
			for (const warning of warnings) {
				lines.push(`  ${warning.document}: ${warning.problem}`);
			}
		}
		output.log(lines.join("\n"));
		return 0;
	} catch (error) {
		output.error(await formatValidationError(error, workingDirectory));
		return 1;
	} finally {
		await gitSourceStore.dispose();
	}
}
