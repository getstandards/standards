import { stat } from "node:fs/promises";
import path from "node:path";
import { runGit } from "../utils/git.js";
import type { ChangedFile } from "./change-diff.js";
import type { ChangeScope } from "./change-scope.js";

/** Name the place a target must exist in, per change scope (specs/cli.md targets). */
function scopeTargetPlace(scope: ChangeScope): string {
	switch (scope.kind) {
		case "commits":
			return "the head revision";
		case "working-tree":
			return "the working tree";
		case "staged":
			return "the index";
	}
}

/**
 * A review target that does not exist in the scope's head side and matches no
 * deleted file's base path (specs/cli.md targets).
 */
export class ReviewTargetError extends Error {
	public constructor(
		public readonly target: string,
		/** Where the target had to exist: the head revision, working tree, or index. */
		public readonly place = "the head revision",
	) {
		super(
			`Target '${target}' does not exist in ${place} and matches no deleted file.`,
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
	scope: ChangeScope;
	workingDirectory: string;
	changedFiles: readonly ChangedFile[];
}

/**
 * Throw ReviewTargetError for a target that does not exist in the scope's head
 * side and matches no deleted file's base path (specs/cli.md targets). A valid
 * target that matches no changed file is not an error.
 */
export async function validateTargets(
	options: ValidateTargetsOptions,
): Promise<void> {
	const place = scopeTargetPlace(options.scope);
	const deletedPaths = options.changedFiles
		.filter((file) => file.status === "deleted")
		.map((file) => file.path);
	for (const target of options.targets) {
		if (target === "") {
			throw new ReviewTargetError(target, place);
		}
		if (deletedPaths.some((path) => targetMatchesPath(target, path))) {
			continue;
		}
		if (!(await existsInScope(target, options))) {
			throw new ReviewTargetError(target, place);
		}
	}
}

/** Return whether a path names a file or directory on the scope's head side. */
async function existsInScope(
	target: string,
	options: ValidateTargetsOptions,
): Promise<boolean> {
	switch (options.scope.kind) {
		case "commits":
			return gitPathExists(
				["cat-file", "-e", `${options.scope.headRevision}:${target}`],
				options.workingDirectory,
			);
		case "staged":
			// The index holds no tree entries, so a directory target exists
			// exactly when the index holds a file under it.
			return (
				(
					await runGit(
						["--literal-pathspecs", "ls-files", "--cached", "--", target],
						options.workingDirectory,
					)
				).length > 0
			);
		case "working-tree":
			return existsInWorkingTree(target, options.workingDirectory);
	}
}

/** Return whether a Git command that checks path existence succeeds. */
async function gitPathExists(
	arguments_: string[],
	workingDirectory: string,
): Promise<boolean> {
	try {
		await runGit(arguments_, workingDirectory);
		return true;
	} catch {
		return false;
	}
}

/**
 * Return whether a repository-relative target names a file or directory in the
 * working tree. A target that escapes the repository root is not a target.
 */
async function existsInWorkingTree(
	target: string,
	workingDirectory: string,
): Promise<boolean> {
	const resolved = path.resolve(workingDirectory, target);
	const relative = path.relative(workingDirectory, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return false;
	}
	try {
		await stat(resolved);
		return true;
	} catch {
		return false;
	}
}
