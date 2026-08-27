import { runGit, runGitDiff } from "../utils/git.js";
import type { ChangeScope } from "./change-scope.js";

/** How a changed file differs between the base and head revisions. */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** One contiguous block of changed lines between the base and head revisions. */
export interface DiffHunk {
	/** First line of the hunk in the base revision. */
	baseStart: number;
	/** Number of base-revision lines the hunk covers. */
	baseLines: number;
	/** First line of the hunk in the head revision. */
	headStart: number;
	/** Number of head-revision lines the hunk covers. */
	headLines: number;
	/** Hunk body lines, each prefixed with ' ' for context, '+' added, or '-' removed. */
	lines: string[];
}

/**
 * One file that differs between the base and head revisions.
 *
 * `path` is the head path for an added, modified, or renamed file, and the base
 * path for a deleted file. `basePath` is present only for a renamed file. A
 * binary file carries no hunks and is excluded from rule selection.
 */
export interface ChangedFile {
	status: ChangeStatus;
	path: string;
	basePath?: string;
	binary: boolean;
	hunks: DiffHunk[];
}

/** Inputs that select the change to compute (specs/review.md). */
export interface ComputeChangeOptions {
	/** The change the review compares. */
	scope: ChangeScope;
	/** The head checkout directory that Git runs in. */
	workingDirectory: string;
	/** Context lines kept around each hunk. Defaults to 3. */
	contextLines?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;

/**
 * Compute the changed files and their hunks of one change scope
 * (specs/review.md change scope).
 *
 * It runs `git diff` in the head checkout with rename detection and quoting
 * turned off, then parses the unified diff. A full review passes the empty tree
 * as the base revision, so every file of the head side is an added file.
 */
export async function computeChange(
	options: ComputeChangeOptions,
): Promise<ChangedFile[]> {
	const contextLines = options.contextLines ?? 3;
	const scope = options.scope;
	const diffArguments = [
		"-c",
		"core.quotePath=false",
		"diff",
		"--no-color",
		"--find-renames",
		`--unified=${contextLines}`,
	];
	if (scope.kind === "staged") {
		diffArguments.push("--cached");
	}
	diffArguments.push(scope.baseRevision);
	if (scope.kind === "commits") {
		diffArguments.push(scope.headRevision);
	}

	const files = parseUnifiedDiff(
		await runGitDiff(diffArguments, options.workingDirectory),
	);
	if (scope.kind !== "working-tree") {
		return files;
	}
	return [
		...files,
		...(await computeUntrackedFiles(options.workingDirectory, contextLines)),
	];
}

/**
 * Compute the untracked files of the working tree as added files
 * (specs/review.md change scope).
 *
 * `git ls-files --others --exclude-standard` lists exactly the untracked files
 * that Git does not ignore, in path order. Each one is diffed against
 * `/dev/null`, which emits the `new file mode` and `+++ b/<path>` markers that
 * the unified-diff parser reads.
 */
async function computeUntrackedFiles(
	workingDirectory: string,
	contextLines: number,
): Promise<ChangedFile[]> {
	const listing = await runGit(
		[
			"-c",
			"core.quotePath=false",
			"ls-files",
			"--others",
			"--exclude-standard",
		],
		workingDirectory,
	);
	const files: ChangedFile[] = [];
	for (const untrackedPath of listing
		.split("\n")
		.filter((line) => line !== "")) {
		const diff = await runGitDiff(
			[
				"-c",
				"core.quotePath=false",
				"diff",
				"--no-color",
				`--unified=${contextLines}`,
				"--no-index",
				"--",
				"/dev/null",
				untrackedPath,
			],
			workingDirectory,
		);
		files.push(...parseUnifiedDiff(diff));
	}
	return files;
}

/** Parse the unified diff text that `git diff` writes into changed files. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
	const files: ChangedFile[] = [];
	let current: MutableChangedFile | undefined;
	let hunk: DiffHunk | undefined;

	const finishFile = (): void => {
		if (current !== undefined) {
			files.push(toChangedFile(current));
		}
		current = undefined;
		hunk = undefined;
	};

	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			finishFile();
			current = { status: "modified", binary: false, hunks: [] };
			continue;
		}
		if (current === undefined) {
			continue;
		}
		if (line.startsWith("new file mode")) {
			current.status = "added";
			continue;
		}
		if (line.startsWith("deleted file mode")) {
			current.status = "deleted";
			continue;
		}
		if (line.startsWith("rename from ")) {
			current.status = "renamed";
			current.basePath = line.slice("rename from ".length);
			continue;
		}
		if (line.startsWith("rename to ")) {
			current.status = "renamed";
			current.headPath = line.slice("rename to ".length);
			continue;
		}
		if (line.startsWith("Binary files ")) {
			current.binary = true;
			continue;
		}
		if (line.startsWith("--- ")) {
			current.basePath = pathFromDiffMarker(line.slice("--- ".length));
			continue;
		}
		if (line.startsWith("+++ ")) {
			current.headPath = pathFromDiffMarker(line.slice("+++ ".length));
			continue;
		}
		const headerMatch = HUNK_HEADER.exec(line);
		if (headerMatch !== null) {
			hunk = {
				baseStart: Number(headerMatch[1]),
				baseLines: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
				headStart: Number(headerMatch[3]),
				headLines: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
				lines: [],
			};
			current.hunks.push(hunk);
			continue;
		}
		if (
			hunk !== undefined &&
			(line.startsWith(" ") || line.startsWith("+") || line.startsWith("-"))
		) {
			hunk.lines.push(line);
		}
	}
	finishFile();
	return files;
}

/** A changed file whose paths and status are still being filled in during parsing. */
interface MutableChangedFile {
	status: ChangeStatus;
	binary: boolean;
	hunks: DiffHunk[];
	headPath?: string;
	basePath?: string;
}

/** Turn a parsed file record into a changed file with a resolved path. */
function toChangedFile(file: MutableChangedFile): ChangedFile {
	const path =
		file.status === "deleted"
			? (file.basePath ?? file.headPath ?? "")
			: (file.headPath ?? file.basePath ?? "");
	const changed: ChangedFile = {
		status: file.status,
		path,
		binary: file.binary,
		hunks: file.hunks,
	};
	if (file.status === "renamed" && file.basePath !== undefined) {
		changed.basePath = file.basePath;
	}
	return changed;
}

/** Read the file path from a `--- a/path` or `+++ b/path` marker, or none for /dev/null. */
function pathFromDiffMarker(marker: string): string | undefined {
	if (marker === "/dev/null") {
		return undefined;
	}
	if (marker.startsWith("a/") || marker.startsWith("b/")) {
		return marker.slice(2);
	}
	return marker;
}
