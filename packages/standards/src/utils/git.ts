import { execFile } from "node:child_process";

/** Run Git without an interactive credential prompt. */
export function runGit(
	arguments_: string[],
	workingDirectory: string,
): Promise<string> {
	return runGitCommand(arguments_, workingDirectory, true);
}

/**
 * Run Git and return the raw standard output, without trimming.
 *
 * A command that returns file content, such as `git show <revision>:<path>`,
 * needs the raw output: content can start or end with whitespace that is
 * part of a line, and trimming would shift or corrupt it.
 */
export function runGitOutput(
	arguments_: string[],
	workingDirectory: string,
): Promise<string> {
	return runGitCommand(arguments_, workingDirectory, false);
}

/** Run one Git command and resolve with its standard output. */
function runGitCommand(
	arguments_: string[],
	workingDirectory: string,
	trimOutput: boolean,
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			arguments_,
			{
				cwd: workingDirectory,
				encoding: "utf8",
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				maxBuffer: 10 * 1024 * 1024,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error !== null) {
					reject(new Error(stderr.trim() || error.message));
					return;
				}
				resolve(trimOutput ? stdout.trim() : stdout);
			},
		);
	});
}
