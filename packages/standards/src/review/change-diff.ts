import { runGit } from "../utils/git.js";

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
	/** The commit the change is compared against, or the empty tree for a full review. */
	baseRevision: string;
	/** The commit that contains the change, checked out on disk. */
	headRevision: string;
	/** The head checkout directory that Git runs in. */
	workingDirectory: string;
	/** Context lines kept around each hunk. Defaults to 3. */
	contextLines?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;

/**
 * Compute the changed files and their hunks between two revisions.
 *
 * It runs `git diff` in the head checkout with rename detection and quoting
 * turned off, then parses the unified diff. A full review passes the empty tree
 * as `baseRevision`, so every tracked file of the head revision is an added
 * file (specs/review.md).
 */
export async function computeChange(
	options: ComputeChangeOptions,
): Promise<ChangedFile[]> {
	const contextLines = options.contextLines ?? 3;
	const diff = await runGit(
		[
			"-c",
			"core.quotePath=false",
			"diff",
			"--no-color",
			"--find-renames",
			`--unified=${contextLines}`,
			options.baseRevision,
			options.headRevision,
		],
		options.workingDirectory,
	);
	return parseUnifiedDiff(diff);
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
