import path from "node:path";
import {
	LockfileUpdateError,
	updateLockfile,
} from "../../lockfile/lockfile-updater.js";
import type { CommandContext } from "../cli-context.js";
import { formatValidationError } from "./validate-diagnostic.js";

/** Resolve mutable sources and update the Standards lock file. */
export async function runLockCommand({
	workingDirectory,
	output,
}: CommandContext): Promise<number> {
	try {
		const result = await updateLockfile(workingDirectory);
		const branchCount = result.lockfile.sources.filter(
			({ revision }) => "branch" in revision,
		).length;
		const tagCount = result.lockfile.sources.length - branchCount;
		const status = result.changed
			? "Standards lock file updated."
			: "Standards lock file is already up to date.";

		output.log(`${status}

  Repository:      ${result.repositoryRoot}
  Lock file:       ${path.basename(result.lockfilePath)}
  Mutable sources: ${result.lockfile.sources.length}
  Branches:        ${branchCount}
  Tags:            ${tagCount}`);
		return 0;
	} catch (error) {
		if (error instanceof LockfileUpdateError) {
			output.error(`Standards lock file was not updated.

Problem:
  ${error.message}

Next action:
  Verify every Git repository URL, tag, and branch in the configuration, then run 'standards lock' again.`);
			return 1;
		}

		output.error(await formatValidationError(error, workingDirectory));
		return 1;
	}
}
