import path from "node:path";
import {
	nonEmptyEnvironmentValue,
	resolveHomeDirectory,
} from "../utils/environment.js";

/** Inputs that select the Standards source cache directory. */
export interface CacheDirectoryOptions {
	cacheDir?: string;
	settingsCacheDir?: string;
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
			nonEmptyEnvironmentValue(environment.LOCALAPPDATA) ??
			path.win32.join(homeDirectory, "AppData", "Local");
		return path.win32.join(localAppData, "standards", "cache");
	}

	const xdgCacheHome = nonEmptyEnvironmentValue(environment.XDG_CACHE_HOME);
	if (xdgCacheHome !== undefined) {
		return path.join(xdgCacheHome, "standards");
	}
	return path.join(homeDirectory, ".cache", "standards");
}

/** Expand a leading home-directory marker in a source cache directory. */
function expandHomeCacheDirectory(
	directory: string,
	platform: NodeJS.Platform,
	homeDirectory: string,
): string {
	if (directory === "~") {
		return homeDirectory;
	}

	const hasHomePrefix =
		directory.startsWith("~/") ||
		(platform === "win32" && directory.startsWith("~\\"));
	if (!hasHomePrefix) {
		return directory;
	}

	const platformPath = platform === "win32" ? path.win32 : path;
	return platformPath.join(homeDirectory, directory.slice(2));
}

/**
 * Resolve the persistent source cache directory and the disabled flag.
 *
 * The `--cache-dir` option wins over `STANDARDS_CACHE_DIR`, which wins over the
 * settings file and then the platform default. The cache is disabled by
 * `--no-cache` or by a non-empty `STANDARDS_NO_CACHE` value. The directory is
 * always returned so that cache commands can locate it.
 */
export function resolveCacheDirectory(
	options: CacheDirectoryOptions,
): ResolvedCacheDirectory {
	const environment = options.environment ?? process.env;
	const platform = options.platform ?? process.platform;
	const homeDirectory =
		options.homeDirectory ?? resolveHomeDirectory(environment, platform);

	const directory =
		options.cacheDir ??
		nonEmptyEnvironmentValue(environment.STANDARDS_CACHE_DIR) ??
		options.settingsCacheDir ??
		platformDefaultCacheDirectory(environment, platform, homeDirectory);

	const disabled =
		options.noCache === true ||
		nonEmptyEnvironmentValue(environment.STANDARDS_NO_CACHE) !== undefined;

	const platformPath = platform === "win32" ? path.win32 : path;
	return {
		directory: platformPath.resolve(
			expandHomeCacheDirectory(directory, platform, homeDirectory),
		),
		disabled,
	};
}
