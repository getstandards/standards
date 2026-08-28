import path from "node:path";
import {
	nonEmptyEnvironmentValue,
	resolveHomeDirectory,
} from "@getstandards/core/internal";

/** Runtime values used to locate the Standards credential file. */
export interface AuthFilePathOptions {
	environment?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	homeDirectory?: string;
}

/**
 * Resolve the per-user Standards credential file path for the current platform.
 *
 * The file holds provider credentials that `standards auth login` saved. It lives at
 * `$XDG_CONFIG_HOME/standards/auth.json` (or `$HOME/.config/standards/auth.json`)
 * on Unix systems and `%APPDATA%\standards\auth.json` on Windows.
 */
export function resolveAuthFilePath(options: AuthFilePathOptions = {}): string {
	const environment = options.environment ?? process.env;
	const platform = options.platform ?? process.platform;
	const homeDirectory =
		options.homeDirectory ?? resolveHomeDirectory(environment, platform);

	if (platform === "win32") {
		const applicationData =
			nonEmptyEnvironmentValue(environment.APPDATA) ??
			path.win32.join(homeDirectory, "AppData", "Roaming");
		return path.win32.join(applicationData, "standards", "auth.json");
	}

	const configHome =
		nonEmptyEnvironmentValue(environment.XDG_CONFIG_HOME) ??
		path.join(homeDirectory, ".config");
	return path.join(configHome, "standards", "auth.json");
}
