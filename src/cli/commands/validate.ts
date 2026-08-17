import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { loadRules } from "../../config/configuration-resolver.js";
import { requirementLevels } from "../../config/configuration-schema.js";
import type { CommandContext } from "../cli-context.js";
import { formatValidationError } from "./validate-diagnostic.js";

const ENTRY_FILE_NAME = ".standards.yml";
const LOCK_FILE_NAME = ".standards.lock";

/** Return whether a path is accessible. */
async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

/** Validate and resolve the Standards configuration in the working directory. */
export async function runValidateCommand({
	workingDirectory,
	output,
}: CommandContext): Promise<number> {
	try {
		const rules = await loadRules(workingDirectory);
		const repositoryRoot = await realpath(workingDirectory);
		const hasLockfile = await pathExists(
			path.join(repositoryRoot, LOCK_FILE_NAME),
		);
		const levelSummary = requirementLevels
			.map((level) => ({
				level,
				count: rules.filter((rule) => rule.level === level).length,
			}))
			.filter(({ count }) => count > 0)
			.map(({ level, count }) => `${level}: ${count}`)
			.join(", ");

		output.log(`Standards configuration is valid.

  Repository:     ${repositoryRoot}
  Entry file:     ${ENTRY_FILE_NAME}
  Lock file:      ${hasLockfile ? `${LOCK_FILE_NAME} (present)` : "not present"}
  Resolved rules: ${rules.length}
  Levels:         ${levelSummary || "none"}`);
		return 0;
	} catch (error) {
		output.error(await formatValidationError(error, workingDirectory));
		return 1;
	}
}
