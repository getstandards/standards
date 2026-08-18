import path from "node:path";
import {
	nonEmptyEnvironmentValue,
	resolveHomeDirectory,
} from "../utils/environment.js";

/** Runtime values used to locate the Standards settings file. */
export interface StandardsSettingsPathOptions {
	environment?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	homeDirectory?: string;
}

/** Resolve the per-user Standards settings file path for the current platform. */
export function resolveStandardsSettingsPath(
	options: StandardsSettingsPathOptions = {},
): string {
	const environment = options.environment ?? process.env;
	const platform = options.platform ?? process.platform;
	const homeDirectory =
		options.homeDirectory ?? resolveHomeDirectory(environment, platform);

	if (platform === "win32") {
		const applicationData =
			nonEmptyEnvironmentValue(environment.APPDATA) ??
			path.win32.join(homeDirectory, "AppData", "Roaming");
		return path.win32.join(applicationData, "standards", "settings.yml");
	}

	const configHome =
		nonEmptyEnvironmentValue(environment.XDG_CONFIG_HOME) ??
		path.join(homeDirectory, ".config");
	return path.join(configHome, "standards", "settings.yml");
}
