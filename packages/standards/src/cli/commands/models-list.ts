import type { Models } from "@earendil-works/pi-ai";
import { DEFAULT_PROVIDER_MODELS } from "@getstandards/core";
import { errorMessage } from "@getstandards/core/internal";
import { resolveAuthFilePath } from "../../credentials/auth-file-location.js";
import { createStandardsModels } from "../../credentials/models-runtime.js";
import {
	formatProviderCredentialState,
	hasUsableCredential,
	type ProviderCredentialReport,
	readProviderCredentialStates,
} from "../../credentials/provider-credential-state.js";
import type { ModelsCliArgs } from "../cli-args.js";
import type { CommandContext } from "../cli-context.js";
import { withoutDatedModelAliases } from "./dated-model-alias.js";
import { formatKnownProvidersDiagnostic } from "./known-providers-diagnostic.js";

/** One provider section of the `standards models` listing. */
interface ProviderModelSection {
	report: ProviderCredentialReport;
	/** Model ids of this provider, without their provider prefix. */
	modelIds: readonly string[];
	/** Why this provider's models are missing, when reading them failed. */
	problem?: string;
}

/**
 * Build one provider section, keeping a failure inside that section.
 *
 * A provider with a usable credential lists the models the SDK reports as
 * available for that credential. A provider without one lists its complete
 * catalog, so the user can see what a login would unlock. Listing is best
 * effort per provider: a catalog failure becomes a note under its provider so
 * the other providers still print.
 */
async function buildProviderModelSection(
	models: Models,
	report: ProviderCredentialReport,
	showEveryModelId: boolean,
): Promise<ProviderModelSection> {
	try {
		const catalog = hasUsableCredential(report)
			? await models.getAvailable(report.providerId)
			: models.getModels(report.providerId);
		const modelIds = catalog.map((model) => model.id);
		return {
			report,
			modelIds: showEveryModelId
				? modelIds
				: withoutDatedModelAliases(modelIds),
		};
	} catch (error) {
		return { report, modelIds: [], problem: errorMessage(error) };
	}
}

/**
 * Render one provider section: its heading, then one complete model reference
 * per line. Every model line is a `<provider>/<model>` reference that the user
 * can pass to `--model` without edits.
 */
function renderProviderModelSection(section: ProviderModelSection): string[] {
	const { providerId, state } = section.report;
	const defaultModelId = DEFAULT_PROVIDER_MODELS[providerId];
	const lines = [`${providerId}  ${formatProviderCredentialState(state)}`];

	if (section.problem !== undefined) {
		lines.push(`  Could not list the models: ${section.problem}`);
		return lines;
	}
	if (section.modelIds.length === 0) {
		lines.push("  No model in the catalog.");
		return lines;
	}

	for (const modelId of section.modelIds) {
		const marker = modelId === defaultModelId ? " (default)" : "";
		lines.push(`  ${providerId}/${modelId}${marker}`);
	}
	return lines;
}

/** Render the footer of the default and `--all` views: the count, then the next actions. */
function renderModelsFooter(
	reports: readonly ProviderCredentialReport[],
	usableCount: number,
	showEveryProvider: boolean,
): string[] {
	const nextActions = [
		"Run 'standards auth login <provider>' to add a provider credential.",
	];
	if (!showEveryProvider) {
		nextActions.unshift(
			"Run 'standards models --all' to list every provider and model.",
		);
	}

	return [
		`${usableCount} of ${reports.length} providers have a usable credential.`,
		"",
		"Next actions:",
		...nextActions.map((action) => `  ${action}`),
	];
}

/**
 * List the model references of one provider (`standards models <provider>`).
 *
 * A provider without a usable credential still shows its catalog, followed by
 * the login that makes those references usable.
 */
function renderSingleProviderView(section: ProviderModelSection): string[] {
	const { providerId } = section.report;
	const lines = renderProviderModelSection(section);

	if (!hasUsableCredential(section.report)) {
		lines.push(
			"",
			`Provider '${providerId}' has no usable credential.`,
			"",
			"Next action:",
			`  Run 'standards auth login ${providerId}' to store a credential.`,
		);
	}
	return lines;
}

/**
 * List usable model references, grouped by provider (`standards models`).
 *
 * The command is read only. By default it shows only the providers that have a
 * usable credential; `--all` shows every known provider with its complete
 * catalog. It exits with status `0` on success and `1` on any failure, so an
 * empty default view is a success, not a negative result: `standards auth
 * status` is the command that signals the empty state through its exit status.
 */
export async function runModelsCommand(
	context: CommandContext,
	args: ModelsCliArgs,
): Promise<number> {
	const { models, credentialStore } = createStandardsModels({
		authFilePath: resolveAuthFilePath({ environment: context.environment }),
	});

	if (
		args.provider !== undefined &&
		models.getProvider(args.provider) === undefined
	) {
		context.output.error(
			formatKnownProvidersDiagnostic(
				"models",
				args.provider,
				models.getProviders(),
			),
		);
		return 1;
	}

	const reports = await readProviderCredentialStates(models, credentialStore);
	const usableCount = reports.filter(hasUsableCredential).length;

	if (args.provider !== undefined) {
		const report = reports.find(
			({ providerId }) => providerId === args.provider,
		);
		if (report === undefined) {
			// Unreachable: the states cover every registered provider, and the
			// provider was checked against the registry above.
			throw new Error(
				`Provider '${args.provider}' has no credential state report.`,
			);
		}
		const section = await buildProviderModelSection(models, report, args.all);
		context.output.log(renderSingleProviderView(section).join("\n"));
		return 0;
	}

	if (usableCount === 0 && !args.all) {
		context.output.log(`No provider has a usable credential.

Next actions:
  Run 'standards auth login <provider>' to store a provider credential.
  Run 'standards models --all' to list every provider and model.`);
		return 0;
	}

	const selected = args.all ? reports : reports.filter(hasUsableCredential);
	const sections = await Promise.all(
		selected.map((report) =>
			buildProviderModelSection(models, report, args.all),
		),
	);

	const lines = sections.flatMap((section) => [
		...renderProviderModelSection(section),
		"",
	]);
	lines.push(...renderModelsFooter(reports, usableCount, args.all));

	context.output.log(lines.join("\n"));
	return 0;
}
