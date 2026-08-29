import { errorMessage } from "../utils/errors.js";
import { runGit } from "../utils/git.js";

/**
 * The change that one review compares (specs/review.md change scope).
 *
 * A `commits` scope compares two commits. A `working-tree` scope compares a
 * base commit with the working tree, so staged, unstaged, and untracked
 * changes are all reviewed. A `staged` scope compares `HEAD` with the index,
 * so only the staged changes are reviewed.
 */
export type ChangeScope =
	| { kind: "commits"; baseRevision: string; headRevision: string }
	| { kind: "working-tree"; baseRevision: string }
	| { kind: "staged"; baseRevision: string };

/** Name the head side of a scope for verbose output (specs/cli.md review). */
export function describeScopeHead(scope: ChangeScope): string {
	switch (scope.kind) {
		case "commits":
			return scope.headRevision;
		case "working-tree":
			return "working tree";
		case "staged":
			return "index";
	}
}

/** The review could not run: its diagnostic is ready to print (specs/cli.md). */
export class ReviewInputError extends Error {
	public constructor(diagnostic: string) {
		super(diagnostic);
		this.name = "ReviewInputError";
	}
}

/** The scope options of one review, as `standards review` names them. */
export interface ChangeScopeOptions {
	/** A `<base>..<head>` or `<base>...<head>` Git commit range. */
	range?: string;
	/** Compare `HEAD` with the index. */
	staged?: boolean;
	/** Compare the empty tree with the working tree: a full review. */
	all?: boolean;
	/** Replace the default base with this revision. */
	base?: string;
}

/**
 * Resolve the change scope of one review (specs/cli.md review).
 *
 * Without a scope option the scope is the working tree against the merge base
 * of HEAD and the remote default branch, so uncommitted work is reviewed.
 * `--base` replaces that base, `--all` replaces it with the empty tree,
 * `--range` selects two commits, and `--staged` selects the index.
 */
export async function resolveChangeScope(
	workingDirectory: string,
	options: ChangeScopeOptions,
): Promise<ChangeScope> {
	// Every scope needs a repository with at least one commit.
	let headRevision: string;
	try {
		headRevision = await runGit(
			["rev-parse", "--verify", "HEAD"],
			workingDirectory,
		);
	} catch (error) {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the head revision HEAD: ${errorMessage(error)}

Next action:
  Run 'standards review' inside a Git repository with at least one commit.`);
	}

	if (options.range !== undefined) {
		return resolveRangeScope(workingDirectory, options.range);
	}

	if (options.staged === true) {
		return { kind: "staged", baseRevision: headRevision };
	}

	if (options.all === true) {
		// The hash of the empty tree, computed so it matches the repository's
		// object format (SHA-1 or SHA-256).
		const emptyTree = await runGit(
			["hash-object", "-t", "tree", "/dev/null"],
			workingDirectory,
		);
		return { kind: "working-tree", baseRevision: emptyTree };
	}

	if (options.base !== undefined) {
		try {
			const baseRevision = await runGit(
				["rev-parse", "--verify", `${options.base}^{commit}`],
				workingDirectory,
			);
			return { kind: "working-tree", baseRevision };
		} catch (error) {
			throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the base revision '${options.base}': ${errorMessage(error)}

Next action:
  Give --base a revision that Git can resolve in this repository.`);
		}
	}

	try {
		const remoteDefaultBranch = await runGit(
			["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
			workingDirectory,
		);
		const baseRevision = await runGit(
			["merge-base", "HEAD", remoteDefaultBranch],
			workingDirectory,
		);
		return { kind: "working-tree", baseRevision };
	} catch {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the merge base of HEAD and the remote default branch.

Next action:
  Give a base revision with --base <revision>, a commit range with
  --range <base>..<head>, or run a full review with --all.`);
	}
}

/**
 * Resolve a `--range` value to a commits scope (specs/cli.md review --range).
 *
 * `A..B` compares the two commits. `A...B` compares the merge base of A and B
 * with B, which is the change B adds to A.
 */
async function resolveRangeScope(
	workingDirectory: string,
	range: string,
): Promise<ChangeScope> {
	const symmetricIndex = range.indexOf("...");
	const separatorIndex =
		symmetricIndex === -1 ? range.indexOf("..") : symmetricIndex;
	const separatorLength = symmetricIndex === -1 ? 2 : 3;
	const left = separatorIndex === -1 ? "" : range.slice(0, separatorIndex);
	const right =
		separatorIndex === -1 ? "" : range.slice(separatorIndex + separatorLength);
	if (separatorIndex === -1 || left === "" || right === "") {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Option '--range' expects '<base>..<head>' or '<base>...<head>', not '${range}'.

Next action:
  Give --range a Git commit range, such as 'main..HEAD' or 'HEAD~3..HEAD'.`);
	}

	const headRevision = await resolveRangeRevision(
		workingDirectory,
		range,
		right,
	);
	if (symmetricIndex === -1) {
		const baseRevision = await resolveRangeRevision(
			workingDirectory,
			range,
			left,
		);
		return { kind: "commits", baseRevision, headRevision };
	}

	// A symmetric range resolves both sides first, so an unresolvable revision
	// reports itself instead of a merge-base failure.
	await resolveRangeRevision(workingDirectory, range, left);
	try {
		const baseRevision = await runGit(
			["merge-base", left, right],
			workingDirectory,
		);
		return { kind: "commits", baseRevision, headRevision };
	} catch (error) {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the merge base of '${left}' and '${right}': ${errorMessage(error)}

Next action:
  Give --range two commits that share history, or use '${left}..${right}'.`);
	}
}

/** Resolve one side of a `--range` value to a commit. */
async function resolveRangeRevision(
	workingDirectory: string,
	range: string,
	revision: string,
): Promise<string> {
	try {
		return await runGit(
			["rev-parse", "--verify", `${revision}^{commit}`],
			workingDirectory,
		);
	} catch (error) {
		throw new ReviewInputError(`Standards review could not run.

Problem:
  Cannot resolve the revision '${revision}' of '--range ${range}': ${errorMessage(error)}

Next action:
  Give --range two revisions that Git can resolve in this repository.`);
	}
}
