import { realpath } from "node:fs/promises";
import path from "node:path";
import { ConfigurationLoadError } from "../../config/configuration-loader.js";
import { ConfigurationResolutionError } from "../../rules/rules-loader.js";
import { errorMessage } from "../../utils/errors.js";

interface DiagnosticDetails {
	category: string;
	repository: string;
	source?: string;
	field?: string;
	problem: string;
	nextAction: string;
}

/** Remove location information already rendered as diagnostic fields. */
function problemWithoutLocation(
	message: string,
	source: string,
	field?: string,
): string {
	const location = field === undefined ? source : `${source}:${field}`;
	const prefix = `${location}: `;
	return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

/** Suggest a correction for a configuration field. */
function fieldNextAction(source: string, field: string | undefined): string {
	if (field === "version") {
		return `Set 'version' to 2 in '${source}', then run 'standards validate' again.`;
	}
	if (field !== undefined) {
		return `Correct '${field}' in '${source}', then run 'standards validate' again.`;
	}
	return `Correct '${source}', then run 'standards validate' again.`;
}

/** Suggest a correction for a configuration-resolution failure. */
function resolutionNextAction(message: string): string {
	if (message.includes(".standards.yml") && message.includes("Cannot read")) {
		return "Create '.standards.yml' at the repository root and define configuration version 2.";
	}
	if (message.includes("does not exist in knowledge source")) {
		return "Map a 'folder' that exists in the knowledge source, or remove the mapping.";
	}
	if (message.includes("duplicates the rule")) {
		return "Rename one of the documents so every derived rule id is unique.";
	}
	if (
		message.includes("Cannot reach Git repository") ||
		message.includes("Cannot fetch Git repository") ||
		message.includes("does not exist in")
	) {
		return "Verify the repository URL, branch, credentials, and network access.";
	}
	return "Check the reported knowledge sources and folder mappings, then run 'standards validate' again.";
}

/** Indent every line in a diagnostic section. */
function indent(value: string): string {
	return value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}

/** Render one structured validation diagnostic. */
function renderDiagnostic(details: DiagnosticDetails): string {
	const fields: Array<[string, string]> = [
		["Category", details.category],
		["Repository", details.repository],
	];
	if (details.source !== undefined) {
		fields.push(["Source", details.source]);
	}
	if (details.field !== undefined) {
		fields.push(["Field", details.field]);
	}

	const labelWidth = Math.max(...fields.map(([label]) => label.length));
	const fieldLines = fields.map(
		([label, value]) => `  ${`${label}:`.padEnd(labelWidth + 1)} ${value}`,
	);

	return [
		"Standards configuration is invalid.",
		"",
		...fieldLines,
		"",
		"Problem:",
		indent(details.problem),
		"",
		"Next action:",
		indent(details.nextAction),
	].join("\n");
}

/** Format an error from configuration loading or resolution for CLI users. */
export async function formatValidationError<Thrown>(
	error: Thrown,
	workingDirectory: string,
): Promise<string> {
	let repository: string;
	try {
		repository = await realpath(workingDirectory);
	} catch {
		repository = path.resolve(workingDirectory);
	}

	if (error instanceof ConfigurationLoadError) {
		return renderDiagnostic({
			category: "Configuration validation",
			repository,
			source: error.sourceName,
			field: error.yamlPath,
			problem: problemWithoutLocation(
				error.message,
				error.sourceName,
				error.yamlPath,
			),
			nextAction: fieldNextAction(error.sourceName, error.yamlPath),
		});
	}

	if (error instanceof ConfigurationResolutionError) {
		return renderDiagnostic({
			category: "Configuration resolution",
			repository,
			problem: error.message,
			nextAction: resolutionNextAction(error.message),
		});
	}

	return renderDiagnostic({
		category: "Unexpected error",
		repository,
		problem: errorMessage(error),
		nextAction:
			"Review the error and run 'standards validate' again. Report the problem if it continues.",
	});
}
