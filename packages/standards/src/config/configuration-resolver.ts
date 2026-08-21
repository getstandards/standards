import { readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type {
	GitSourceStore,
	PopulateGitCheckout,
} from "../cache/git-source-cache.js";
import { createTemporaryGitSourceStore } from "../cache/git-source-cache.js";
import type { ImportProgressReporter } from "../cache/import-progress.js";
import { loadLockfile } from "../lockfile/lockfile-loader.js";
import type { Lockfile } from "../lockfile/lockfile-schema.js";
import {
	mutableRevisionKey,
	mutableRevisionParts,
	sourceLockKey,
} from "../lockfile/lockfile-schema.js";
import { errorMessage, isMissingFileError } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import { loadConfiguration } from "./configuration-loader.js";
import type { GitRevision, Rule } from "./configuration-schema.js";

const ENTRY_FILE_NAME = ".standards.yml";
const LOCK_FILE_NAME = ".standards.lock";

interface RepositoryContext {
	root: string;
	repository?: string;
	commit?: string;
}

export type MutableGitRevision = Exclude<GitRevision, { commit: string }>;

export type MutableRevisionResolver = (
	repository: string,
	revision: MutableGitRevision,
) => Promise<string> | string;

/** Optional cache and progress inputs for configuration resolution. */
export interface ResolveConfigurationOptions {
	gitSourceStore?: GitSourceStore;
	reportProgress?: ImportProgressReporter;
}

/** An error found while resolving a Standards configuration graph. */
export class ConfigurationResolutionError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "ConfigurationResolutionError";
	}
}

/** Return true when a path is inside a repository root. */
function isWithinRepository(
	repositoryRoot: string,
	sourcePath: string,
): boolean {
	const relativeSourcePath = path.relative(repositoryRoot, sourcePath);
	return (
		relativeSourcePath === "" ||
		(!relativeSourcePath.startsWith(`..${path.sep}`) &&
			relativeSourcePath !== ".." &&
			!path.isAbsolute(relativeSourcePath))
	);
}

/** Format a canonical path relative to its repository with portable separators. */
function repositoryRelativePath(
	repositoryRoot: string,
	sourcePath: string,
): string {
	return path.relative(repositoryRoot, sourcePath).split(path.sep).join("/");
}

/** Return a readable name for a configuration source. */
function configurationSourceName(
	context: RepositoryContext,
	relativePath: string,
): string {
	if (context.repository !== undefined && context.commit !== undefined) {
		return `${context.repository}@${context.commit}:${relativePath}`;
	}
	return relativePath;
}

/** Return the unique identity of a configuration source. */
function configurationSourceKey(
	context: RepositoryContext,
	relativePath: string,
): string {
	if (context.repository !== undefined && context.commit !== undefined) {
		return `git\u0000${context.repository}\u0000${context.commit}\u0000${relativePath}`;
	}
	return `local\u0000${relativePath}`;
}

/** Resolve a repository root to its canonical absolute path. */
export async function canonicalizeRepositoryRoot(
	repositoryRoot: string,
): Promise<string> {
	try {
		return await realpath(repositoryRoot);
	} catch (error) {
		throw new ConfigurationResolutionError(
			`Cannot access repository root '${repositoryRoot}': ${errorMessage(error)}`,
		);
	}
}

/** Load the root lock file when it exists. */
async function loadRootLockfile(
	repositoryRoot: string,
): Promise<Lockfile | undefined> {
	const lockfilePath = path.join(repositoryRoot, LOCK_FILE_NAME);
	let sourceText: string;
	try {
		sourceText = await readFile(lockfilePath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw new ConfigurationResolutionError(
			`Cannot read lock file '${LOCK_FILE_NAME}': ${errorMessage(error)}`,
		);
	}
	return loadLockfile(sourceText, LOCK_FILE_NAME);
}

/** Resolve a Git revision to the exact commit that must be fetched. */
function resolveLockedGitCommit(
	repository: string,
	revision: MutableGitRevision,
	lockfile: Lockfile | undefined,
	usedLockEntries: Set<string>,
): string {
	if (lockfile === undefined) {
		throw new ConfigurationResolutionError(
			`Git source '${repository}' uses a tag or branch, but '${LOCK_FILE_NAME}' does not exist.`,
		);
	}

	const key = mutableRevisionKey(repository, revision);
	const sourceLock = lockfile.sources.find(
		(candidate) => sourceLockKey(candidate) === key,
	);
	if (sourceLock === undefined) {
		const { type, name } = mutableRevisionParts(revision);
		throw new ConfigurationResolutionError(
			`Lock file has no entry for ${type} '${name}' from '${repository}'.`,
		);
	}

	usedLockEntries.add(key);
	return sourceLock.commit.toLowerCase();
}

/**
 * Populate a destination directory with a verified checkout of one commit,
 * without the `.git` directory. It throws when the checked-out content does not
 * match the requested commit object ID, so unverified content never reaches the
 * cache.
 */
function fetchGitCheckout(
	repository: string,
	commit: string,
): PopulateGitCheckout {
	return async (destinationDirectory) => {
		try {
			await runGit(
				["clone", "--no-checkout", "--quiet", repository, "."],
				destinationDirectory,
			);

			let verifiedCommit: string;
			try {
				verifiedCommit = await runGit(
					["rev-parse", "--verify", `${commit}^{commit}`],
					destinationDirectory,
				);
			} catch {
				await runGit(
					["fetch", "--no-tags", "--quiet", "origin", commit],
					destinationDirectory,
				);
				verifiedCommit = await runGit(
					["rev-parse", "--verify", `${commit}^{commit}`],
					destinationDirectory,
				);
			}

			if (verifiedCommit.toLowerCase() !== commit) {
				throw new Error(
					`Object '${commit}' resolves to different commit '${verifiedCommit}'.`,
				);
			}

			await runGit(
				["checkout", "--detach", "--quiet", commit],
				destinationDirectory,
			);
			const checkedOutCommit = await runGit(
				["rev-parse", "HEAD"],
				destinationDirectory,
			);
			if (checkedOutCommit.toLowerCase() !== commit) {
				throw new Error(
					`Checked out commit '${checkedOutCommit}' instead of '${commit}'.`,
				);
			}

			await rm(path.join(destinationDirectory, ".git"), {
				recursive: true,
				force: true,
			});
		} catch (error) {
			throw new ConfigurationResolutionError(
				`Cannot fetch Git repository '${repository}' at commit '${commit}': ${errorMessage(error)}`,
			);
		}
	};
}

/** Resolve a complete configuration graph using the supplied mutable revisions. */
export async function resolveConfigurationGraph(
	repositoryRoot: string,
	resolveMutableRevision: MutableRevisionResolver,
	options: ResolveConfigurationOptions = {},
): Promise<Rule[]> {
	const canonicalRepositoryRoot =
		await canonicalizeRepositoryRoot(repositoryRoot);

	const resolvedSources = new Set<string>();
	const activeSources = new Map<string, string>();
	const resolvedRules: Rule[] = [];
	const ruleSources = new Map<string, string>();
	const gitRepositories = new Map<string, Promise<RepositoryContext>>();
	const localContext: RepositoryContext = { root: canonicalRepositoryRoot };
	const ownsGitSourceStore = options.gitSourceStore === undefined;
	const gitSourceStore =
		options.gitSourceStore ?? createTemporaryGitSourceStore();

	async function importGitRepository(
		repository: string,
		commit: string,
	): Promise<RepositoryContext> {
		const checkout = await gitSourceStore.provideGitCheckout(
			commit,
			fetchGitCheckout(repository, commit),
		);
		if (checkout.cacheHit) {
			options.reportProgress?.reportCacheHit(repository, commit);
		} else {
			options.reportProgress?.reportFetch(repository, commit);
		}
		return {
			root: await realpath(checkout.contentDirectory),
			repository,
			commit,
		};
	}

	function getGitRepository(
		repository: string,
		commit: string,
	): Promise<RepositoryContext> {
		const key = `${repository}\u0000${commit}`;
		let context = gitRepositories.get(key);
		if (context === undefined) {
			context = importGitRepository(repository, commit);
			gitRepositories.set(key, context);
		}
		return context;
	}

	async function resolveSource(
		context: RepositoryContext,
		candidatePath: string,
	): Promise<void> {
		if (!isWithinRepository(context.root, candidatePath)) {
			throw new ConfigurationResolutionError(
				`Configuration path '${candidatePath}' escapes repository root '${context.root}'.`,
			);
		}

		let canonicalSourcePath: string;
		try {
			canonicalSourcePath = await realpath(candidatePath);
		} catch (error) {
			throw new ConfigurationResolutionError(
				`Cannot access configuration '${candidatePath}': ${errorMessage(error)}`,
			);
		}

		if (!isWithinRepository(context.root, canonicalSourcePath)) {
			throw new ConfigurationResolutionError(
				`Configuration path '${candidatePath}' resolves outside repository root '${context.root}'.`,
			);
		}

		const relativePath = repositoryRelativePath(
			context.root,
			canonicalSourcePath,
		);
		const sourceName = configurationSourceName(context, relativePath);
		const sourceKey = configurationSourceKey(context, relativePath);
		if (activeSources.has(sourceKey)) {
			const cycleStart = [...activeSources.keys()].indexOf(sourceKey);
			const cycleNames = [...activeSources.values()].slice(cycleStart);
			const cycle = [...cycleNames, sourceName].join(" -> ");
			throw new ConfigurationResolutionError(
				`Configuration extension cycle detected: ${cycle}.`,
			);
		}
		if (resolvedSources.has(sourceKey)) {
			return;
		}

		let sourceText: string;
		try {
			sourceText = await readFile(canonicalSourcePath, "utf8");
		} catch (error) {
			throw new ConfigurationResolutionError(
				`Cannot read configuration '${sourceName}': ${errorMessage(error)}`,
			);
		}

		const configuration = loadConfiguration(sourceText, sourceName);
		activeSources.set(sourceKey, sourceName);

		try {
			for (const extension of configuration.extends) {
				if ("git" in extension) {
					const commit = (
						"commit" in extension.git.revision
							? extension.git.revision.commit
							: await resolveMutableRevision(
									extension.git.repository,
									extension.git.revision,
								)
					).toLowerCase();
					const gitContext = await getGitRepository(
						extension.git.repository,
						commit,
					);
					await resolveSource(
						gitContext,
						path.resolve(gitContext.root, extension.git.path),
					);
					continue;
				}

				await resolveSource(
					context,
					path.resolve(path.dirname(canonicalSourcePath), extension.path),
				);
			}

			for (const rule of configuration.rules) {
				const previousSource = ruleSources.get(rule.id);
				if (previousSource !== undefined) {
					throw new ConfigurationResolutionError(
						`Rule ID '${rule.id}' in '${sourceName}' duplicates the rule from '${previousSource}'.`,
					);
				}
				ruleSources.set(rule.id, sourceName);
				resolvedRules.push(rule);
			}

			resolvedSources.add(sourceKey);
		} finally {
			activeSources.delete(sourceKey);
		}
	}

	try {
		await resolveSource(
			localContext,
			path.join(canonicalRepositoryRoot, ENTRY_FILE_NAME),
		);

		return resolvedRules;
	} finally {
		if (ownsGitSourceStore) {
			await gitSourceStore.dispose();
		}
	}
}

/** Resolve a complete configuration graph and return its ordered rules. */
export async function loadRules(
	repositoryRoot: string,
	options: ResolveConfigurationOptions = {},
): Promise<Rule[]> {
	const canonicalRepositoryRoot =
		await canonicalizeRepositoryRoot(repositoryRoot);
	const lockfile = await loadRootLockfile(canonicalRepositoryRoot);
	const usedLockEntries = new Set<string>();
	const rules = await resolveConfigurationGraph(
		canonicalRepositoryRoot,
		(repository, revision) =>
			resolveLockedGitCommit(repository, revision, lockfile, usedLockEntries),
		options,
	);

	if (lockfile !== undefined) {
		const unusedSourceLock = lockfile.sources.find(
			(sourceLock) => !usedLockEntries.has(sourceLockKey(sourceLock)),
		);
		if (unusedSourceLock !== undefined) {
			throw new ConfigurationResolutionError(
				`Lock file entry for '${unusedSourceLock.repository}' is not used by the configuration graph.`,
			);
		}
	}

	return rules;
}

/** @deprecated Use `loadRules` to resolve both local and Git sources. */
export const loadLocalRules = loadRules;
