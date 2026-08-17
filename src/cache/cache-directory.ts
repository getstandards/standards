import os from "node:os";
import path from "node:path";

/** Inputs that select the Standards source cache directory. */
export interface CacheDirectoryOptions {
	cacheDir?: string;
	noCache?: boolean;
	environment?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	homeDirectory?: string;
}

/** The resolved source cache directory and whether the cache is disabled. */
export interface ResolvedCacheDirectory {
	directory: string;
	disabled: boolean;
}

/**
 * Return the platform default source cache directory.
 *
 * macOS follows the XDG convention like other Unix systems.
 */
function platformDefaultCacheDirectory(
	environment: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	homeDirectory: string,
): string {
	if (platform === "win32") {
		const localAppData =
			environment.LOCALAPPDATA ?? path.join(homeDirectory, "AppData", "Local");
		return path.join(localAppData, "standards", "cache");
	}

	const xdgCacheHome = environment.XDG_CACHE_HOME;
	if (xdgCacheHome !== undefined && xdgCacheHome !== "") {
		return path.join(xdgCacheHome, "standards");
	}
	return path.join(homeDirectory, ".cache", "standards");
}

/**
 * Resolve the persistent source cache directory and the disabled flag.
 *
 * The `--cache-dir` option wins over `STANDARDS_CACHE_DIR`, which wins over the
 * platform default. The cache is disabled by `--no-cache` or by a non-empty
 * `STANDARDS_NO_CACHE` value. The directory is always returned so that the
 * `cache clean` and `cache prune` commands can locate it even when a run
 * disables reads and writes.
 */
export function resolveCacheDirectory(
	options: CacheDirectoryOptions,
): ResolvedCacheDirectory {
	const environment = options.environment ?? process.env;
	const platform = options.platform ?? process.platform;
	const homeDirectory = options.homeDirectory ?? os.homedir();

	const directory =
		options.cacheDir ??
		(environment.STANDARDS_CACHE_DIR !== undefined &&
		environment.STANDARDS_CACHE_DIR !== ""
			? environment.STANDARDS_CACHE_DIR
			: platformDefaultCacheDirectory(environment, platform, homeDirectory));

	const disabled =
		options.noCache === true ||
		(environment.STANDARDS_NO_CACHE !== undefined &&
			environment.STANDARDS_NO_CACHE !== "");

	return { directory: path.resolve(directory), disabled };
}
