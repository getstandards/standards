import type { StandardsSettingsLoadError } from "./settings-loader.js";

/** Format a diagnostic for a settings file read or validation failure. */
export function formatStandardsSettingsDiagnostic(
	error: StandardsSettingsLoadError,
): string {
	return `Standards settings could not be loaded.

  Category: Settings validation
  Source:   ${error.settingsPath}
  Field:    ${error.yamlPath ?? "(document)"}

Problem:
  ${error.problem}

Next action:
  Fix '${error.settingsPath}', then run the command again.`;
}
