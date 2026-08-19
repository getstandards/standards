import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolveCacheDirectory } from "../../cache/cache-directory.js";
import {
	GIT_SOURCE_BUCKET_NAME,
	openGitSourceCache,
} from "../../cache/git-source-cache.js";
import type { ImportProgressReporter } from "../../cache/import-progress.js";
import { loadRules } from "../../config/configuration-resolver.js";
import { commitObjectIdSchema } from "../../config/configuration-schema.js";
import { errorMessage, isMissingFileError } from "../../utils/errors.js";
import type { CacheSubcommand } from "../cli-args.js";
import type { CommandContext } from "../cli-context.js";
import { renderCacheHelp } from "../cli-help.js";

/** Remove the whole resolved source cache directory and its buckets. */
async function cleanSourceCache(
	context: CommandContext,
	directory: string,
): Promise<number> {
	let directoryExists = true;
	try {
		await stat(directory);
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
		directoryExists = false;
	}

	if (!directoryExists) {
		context.output.log(`Source cache directory does not exist: ${directory}`);
		return 0;
	}

	await rm(directory, { recursive: true, force: true });
	context.output.log(`Removed source cache at ${directory}`);
	return 0;
}

/** Remove every `git-v1` entry whose commit is not in the referenced set. */
async function removeUnreferencedGitEntries(
	bucketDirectory: string,
	referencedCommits: Set<string>,
): Promise<number> {
	let entryNames: string[];
	try {
		entryNames = await readdir(bucketDirectory);
	} catch (error) {
		if (isMissingFileError(error)) {
			return 0;
		}
		throw error;
	}

	const entryCommits = new Set<string>();
	for (const entryName of entryNames) {
		const commit = entryName.endsWith(".ok")
			? entryName.slice(0, -".ok".length)
			: entryName;
		if (commitObjectIdSchema.safeParse(commit).success) {
			entryCommits.add(commit.toLowerCase());
		}
	}

	let removedCount = 0;
	for (const commit of entryCommits) {
		if (referencedCommits.has(commit)) {
			continue;
		}
		const entryDirectory = path.join(bucketDirectory, commit);
		await rm(entryDirectory, { recursive: true, force: true });
		await rm(`${entryDirectory}.ok`, { force: true });
		removedCount += 1;
	}
	return removedCount;
}

/** Remove source cache entries that the current configuration does not use. */
async function pruneSourceCache(
	context: CommandContext,
	directory: string,
): Promise<number> {
	const referencedCommits = new Set<string>();
	const collectReferencedCommit: ImportProgressReporter = {
		reportResolvingRevision: () => {},
		reportCacheHit: (_repository, commit) => {
			referencedCommits.add(commit);
		},
		reportFetch: (_repository, commit) => {
			referencedCommits.add(commit);
		},
	};

	const gitSourceStore = await openGitSourceCache(directory);
	try {
		await loadRules(context.workingDirectory, {
			gitSourceStore,
			reportProgress: collectReferencedCommit,
		});
	} finally {
		await gitSourceStore.dispose();
	}

	const removedCount = await removeUnreferencedGitEntries(
		path.join(directory, GIT_SOURCE_BUCKET_NAME),
		referencedCommits,
	);
	context.output.log(
		`Removed ${removedCount} source cache ${
			removedCount === 1 ? "entry" : "entries"
		}.`,
	);
	return 0;
}

/** Manage the persistent source cache from the `standards cache` command. */
export async function runCacheCommand(
	context: CommandContext,
	subcommand: CacheSubcommand | undefined,
): Promise<number> {
	if (subcommand === undefined) {
		context.output.error(
			`Command 'cache' requires a subcommand.\n\n${renderCacheHelp()}`,
		);
		return 1;
	}

	const { directory } = resolveCacheDirectory({
		cacheDir: context.cacheDir,
		settingsCacheDir: context.settings?.cache_dir,
		environment: context.environment,
	});

	try {
		if (subcommand === "clean") {
			return await cleanSourceCache(context, directory);
		}
		return await pruneSourceCache(context, directory);
	} catch (error) {
		context.output.error(`Standards cache ${subcommand} failed.

Problem:
  ${errorMessage(error)}

Next action:
  Verify the cache directory '${directory}' and the configuration, then run 'standards cache ${subcommand}' again.`);
		return 1;
	}
}
