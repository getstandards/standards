import {
	access,
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { errorMessage } from "../utils/errors.js";
import type { CacheDirectoryOptions } from "./cache-directory.js";
import { resolveCacheDirectory } from "./cache-directory.js";

/** The versioned cache bucket that holds Git source checkouts. */
export const GIT_SOURCE_BUCKET_NAME = "git-v1";

/** The suffix of the completion marker that proves an entry was verified. */
const COMPLETION_MARKER_SUFFIX = ".ok";

/** The checked-out content of one Git source commit. */
export interface GitSourceCheckout {
	contentDirectory: string;
	cacheHit: boolean;
}

/**
 * Populate an empty destination directory with a verified checkout of one
 * commit, without a `.git` directory. It must throw when the checked-out
 * commit does not match the requested commit object ID.
 */
export type PopulateGitCheckout = (
	destinationDirectory: string,
) => Promise<void>;

/** Store and retrieve verified Git source checkouts by commit object ID. */
export interface GitSourceStore {
	/**
	 * Return the content of one commit, from the cache when present, otherwise
	 * by calling `populate` and publishing the verified result.
	 */
	provideGitCheckout(
		commit: string,
		populate: PopulateGitCheckout,
	): Promise<GitSourceCheckout>;
	/** Remove any temporary directories that this store still owns. */
	dispose(): Promise<void>;
}

/** Return whether a path exists. */
async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

/** Return whether a rename failed because the target already exists. */
function isTargetExistsError<Thrown>(error: Thrown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "EEXIST" || error.code === "ENOTEMPTY")
	);
}

/**
 * Open the persistent Git source cache under a cache directory.
 *
 * Content is stored under the `git-v1` bucket, keyed by the full commit object
 * ID: `<cache-dir>/git-v1/<commit>/` holds the checkout and
 * `<cache-dir>/git-v1/<commit>.ok` is the completion marker. An entry counts as
 * a hit only when both the content directory and the marker exist. This
 * function throws when the bucket cannot be created; the caller then falls back
 * to a temporary store.
 */
export async function openGitSourceCache(
	cacheDirectory: string,
): Promise<GitSourceStore> {
	const bucketDirectory = path.join(cacheDirectory, GIT_SOURCE_BUCKET_NAME);
	await mkdir(bucketDirectory, { recursive: true });

	async function provideGitCheckout(
		commit: string,
		populate: PopulateGitCheckout,
	): Promise<GitSourceCheckout> {
		const entryDirectory = path.join(bucketDirectory, commit);
		const markerPath = `${entryDirectory}${COMPLETION_MARKER_SUFFIX}`;

		if ((await pathExists(entryDirectory)) && (await pathExists(markerPath))) {
			return { contentDirectory: entryDirectory, cacheHit: true };
		}

		const temporaryDirectory = await mkdtemp(
			path.join(bucketDirectory, "publish-"),
		);
		try {
			await populate(temporaryDirectory);

			if (await pathExists(markerPath)) {
				return { contentDirectory: entryDirectory, cacheHit: true };
			}

			await rm(entryDirectory, { recursive: true, force: true });
			try {
				await rename(temporaryDirectory, entryDirectory);
			} catch (error) {
				if (isTargetExistsError(error) && (await pathExists(markerPath))) {
					return { contentDirectory: entryDirectory, cacheHit: true };
				}
				throw error;
			}
			await writeFile(markerPath, "", { encoding: "utf8" });
			return { contentDirectory: entryDirectory, cacheHit: false };
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	}

	return {
		provideGitCheckout,
		dispose: async () => {},
	};
}

/**
 * Create a store that fetches each commit into a per-invocation temporary
 * directory and never reads or writes the persistent cache. It backs a
 * disabled cache and produces the same content as the persistent cache.
 */
export function createTemporaryGitSourceStore(): GitSourceStore {
	const temporaryDirectories: string[] = [];

	async function provideGitCheckout(
		_commit: string,
		populate: PopulateGitCheckout,
	): Promise<GitSourceCheckout> {
		const temporaryDirectory = await mkdtemp(
			path.join(os.tmpdir(), "standards-git-source-"),
		);
		temporaryDirectories.push(temporaryDirectory);
		await populate(temporaryDirectory);
		return { contentDirectory: temporaryDirectory, cacheHit: false };
	}

	return {
		provideGitCheckout,
		dispose: async () => {
			await Promise.all(
				temporaryDirectories
					.splice(0)
					.map((directory) => rm(directory, { recursive: true, force: true })),
			);
		},
	};
}

/** Inputs that select the Git source store for one CLI run. */
export interface RunGitSourceStoreOptions extends CacheDirectoryOptions {
	reportCacheFallback?: (message: string) => void;
}

/**
 * Open the Git source store for one CLI run.
 *
 * A disabled cache uses a temporary store. When the persistent cache directory
 * cannot be created or written, the run reports a diagnostic and continues with
 * a temporary store, so a cache failure never fails an otherwise valid run.
 */
export async function openRunGitSourceStore(
	options: RunGitSourceStoreOptions,
): Promise<GitSourceStore> {
	const { directory, disabled } = resolveCacheDirectory(options);
	if (disabled) {
		return createTemporaryGitSourceStore();
	}
	try {
		return await openGitSourceCache(directory);
	} catch (error) {
		options.reportCacheFallback?.(
			`Source cache disabled: cannot use cache directory '${directory}': ${errorMessage(error)}`,
		);
		return createTemporaryGitSourceStore();
	}
}
