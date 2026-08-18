import os from "node:os";

/** Return the value when it is a non-empty string, otherwise undefined. */
export function nonEmptyEnvironmentValue(
	value: string | undefined,
): string | undefined {
	return value !== undefined && value !== "" ? value : undefined;
}

/** Resolve the user's home directory from the environment for the platform. */
export function resolveHomeDirectory(
	environment: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string {
	const environmentHome =
		platform === "win32" ? environment.USERPROFILE : environment.HOME;
	return nonEmptyEnvironmentValue(environmentHome) ?? os.homedir();
}
