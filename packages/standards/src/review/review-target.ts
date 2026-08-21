import { runGit } from "../utils/git.js";
import type { ChangedFile } from "./change-diff.js";

/**
 * A review target that does not exist in the head revision and matches no
 * deleted file's base path (specs/cli.md targets).
 */
export class ReviewTargetError extends Error {
	public constructor(public readonly target: string) {
		super(
			`Target '${target}' does not exist in the head revision and matches no deleted file.`,
		);
		this.name = "ReviewTargetError";
	}
}

/** Strip trailing slashes so 'src/' and 'src' name the same target. */
export function normalizeTarget(target: string): string {
	return target.replace(/\/+$/, "");
}

/** Return whether a target equals a file's path or is a directory prefix of it. */
export function targetMatchesPath(target: string, filePath: string): boolean {
	return filePath === target || filePath.startsWith(`${target}/`);
}

/**
 * Keep the changed files that at least one target matches (specs/review.md
 * step 1). An empty target set means the whole change. A deleted file matches
 * through its base path, which `ChangedFile.path` already holds.
 */
export function filterChangedFilesByTargets(
	changedFiles: readonly ChangedFile[],
	targets: readonly string[],
): ChangedFile[] {
	if (targets.length === 0) {
		return [...changedFiles];
	}
	return changedFiles.filter((file) =>
		targets.some((target) => targetMatchesPath(target, file.path)),
	);
}

/** What target validation checks each target against (specs/cli.md targets). */
export interface ValidateTargetsOptions {
	targets: readonly string[];
	headRevision: string;
	workingDirectory: string;
	changedFiles: readonly ChangedFile[];
}

/**
 * Throw ReviewTargetError for a target that does not exist in the head
 * revision and matches no deleted file's base path (specs/cli.md targets).
 * A valid target that matches no changed file is not an error.
 */
export async function validateTargets(
	options: ValidateTargetsOptions,
): Promise<void> {
	const deletedPaths = options.changedFiles
		.filter((file) => file.status === "deleted")
		.map((file) => file.path);
	for (const target of options.targets) {
		if (target === "") {
			throw new ReviewTargetError(target);
		}
		if (deletedPaths.some((path) => targetMatchesPath(target, path))) {
			continue;
		}
		if (!(await existsInHeadRevision(target, options))) {
			throw new ReviewTargetError(target);
		}
	}
}

/** Return whether a path names a file or directory in the head revision. */
async function existsInHeadRevision(
	target: string,
	options: ValidateTargetsOptions,
): Promise<boolean> {
	try {
		await runGit(
			["cat-file", "-e", `${options.headRevision}:${target}`],
			options.workingDirectory,
		);
		return true;
	} catch {
		return false;
	}
}
