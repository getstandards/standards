import { execFile } from "node:child_process";

/** Run Git without an interactive credential prompt. */
export function runGit(
	arguments_: string[],
	workingDirectory: string,
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
				resolve(stdout.trim());
			},
		);
	});
}
