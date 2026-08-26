import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import figures from "figures";
import type { CommandContext } from "../cli-context.js";

const ENTRY_FILE_NAME = ".standards.yml";

/** The minimal source configuration that `standards init` writes. */
const CONFIG_CONTENT = `# Standards configuration for this repository.
#
# A source is a directory or a Git repository that holds knowledge documents
# in the Open Knowledge Format. Each 'rules' entry maps one folder of the
# source to a requirement level: MUST is blocking, SHOULD is advisory.
#
# sources:
#   - path: ./knowledge
#     rules:
#       - folder: decisions
#         level: MUST
#       - folder: practices
#         level: SHOULD
#   - git:
#       repository: https://github.com/your-org/engineering-knowledge
#       ref: main
#     rules:
#       - folder: decisions
#         level: MUST
version: 2
sources: []
`;

/** Return true when a candidate path is accessible. */
async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create the entry file for a repository that has none (specs/cli.md init).
 *
 * It writes a minimal version 2 source configuration with an empty source
 * list and commented examples.
 */
export async function runInitCommand(context: CommandContext): Promise<number> {
	const { output, workingDirectory } = context;
	const entryPath = path.join(workingDirectory, ENTRY_FILE_NAME);
	if (await pathExists(entryPath)) {
		output.error(`Standards init could not run.

Problem:
  '.standards.yml' already exists in ${workingDirectory}.

Next action:
  Edit the existing file, or run 'standards init' in a different directory.`);
		return 1;
	}

	await writeFile(entryPath, CONFIG_CONTENT);
	output.log(
		`${figures.tick} Created ${ENTRY_FILE_NAME} in ${workingDirectory}.`,
	);
	return 0;
}
