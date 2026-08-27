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
