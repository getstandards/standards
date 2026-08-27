/** The number of leading commit characters shown in progress lines. */
const SHORT_COMMIT_LENGTH = 12;

/**
 * Report progress while Standards resolves and imports Git sources.
 *
 * Every line names one repository. The caller reports each distinct revision it
 * resolves once and each distinct commit it imports once, so the reporter itself
 * does not remove duplicates.
 */
export interface ImportProgressReporter {
	/** A run resolves a branch to its current commit. */
	reportResolvingRevision(repository: string, branch: string): void;
	/** An import reads a source from the persistent cache. */
	reportCacheHit(repository: string, commit: string): void;
	/** An import fetches a source over the network. */
	reportFetch(repository: string, commit: string): void;
}

/** Return a commit prefix long enough to identify the commit in a log. */
function formatShortCommit(commit: string): string {
	return commit.slice(0, SHORT_COMMIT_LENGTH);
}

/**
 * Create a reporter that writes plain progress lines through `writeLine`.
 *
 * The CLI routes `writeLine` to standard error so that progress never mixes
 * with the machine-readable summary on standard output. Lines contain no
 * credentials because configuration repository URLs never embed credentials.
 */
export function createImportProgressReporter(
	writeLine: (line: string) => void,
): ImportProgressReporter {
	return {
		reportResolvingRevision: (repository, branch) => {
			writeLine(`Resolving ${repository} at branch ${branch}`);
		},
		reportCacheHit: (repository, commit) => {
			writeLine(`Cache hit for ${repository} at ${formatShortCommit(commit)}`);
		},
		reportFetch: (repository, commit) => {
			writeLine(`Fetching ${repository} at ${formatShortCommit(commit)}`);
		},
	};
}
