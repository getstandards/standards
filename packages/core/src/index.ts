/**
 * The public surface of the Standards core library (specs/library.md).
 *
 * It carries resolution, the review pipeline, the models runtime seam, and the
 * types a host renders. Every name here is a compatibility contract, so a name
 * enters this file when a consumer needs it, not before. Internals that a
 * first-party surface needs live behind `@getstandards/core/internal`, which
 * carries no compatibility promise.
 */

export type {
	GitSourceStore,
	RunGitSourceStoreOptions,
} from "./cache/git-source-cache.js";
export { openRunGitSourceStore } from "./cache/git-source-cache.js";
export type { ImportProgressReporter } from "./cache/import-progress.js";
export { createImportProgressReporter } from "./cache/import-progress.js";
export type {
	AppliesTo,
	KnowledgeSource,
	RequirementLevel,
} from "./config/configuration-schema.js";
export type { StepUsage } from "./review/agent-usage.js";
export { formatCost } from "./review/agent-usage.js";
export type {
	ChangeScope,
	ChangeScopeOptions,
} from "./review/change-scope.js";
export { ReviewInputError, resolveChangeScope } from "./review/change-scope.js";
export type { ModelReference } from "./review/model-reference.js";
export { modelReferenceSchema } from "./review/model-reference.js";
export type {
	AgentStep,
	ModelSelectionOptions,
	SelectedModels,
} from "./review/model-selection.js";
export {
	DEFAULT_PROVIDER_MODELS,
	ModelSelectionError,
} from "./review/model-selection.js";
export type { ReviewProviderErrorKind } from "./review/review-agent.js";
export { ReviewProviderError } from "./review/review-agent.js";
export { ReviewConcurrencyError } from "./review/review-concurrency.js";
export type {
	ReviewCompleteOptions,
	ReviewModels,
	ReviewProvider,
} from "./review/review-models.js";
export type {
	CostBasis,
	InvalidSuppression,
	ReportedFinding,
	ReviewConclusion,
	ReviewCounts,
	ReviewReport,
	ReviewUsage,
	SuppressedFinding,
} from "./review/review-report.js";
export { ReviewTargetError } from "./review/review-target.js";
export type { RuleFilterOptions } from "./review/rule-filter.js";
export { filterRuleSet, ReviewRuleFilterError } from "./review/rule-filter.js";
export type { RunReviewInput } from "./review/run-review.js";
export { runReview } from "./review/run-review.js";
export type { ReviewStepProgress } from "./review/step-progress.js";
export type { Rule } from "./rules/rule.js";
export type {
	LoadRulesOptions,
	Resolution,
	ResolvedGitSource,
	RuleWarning,
} from "./rules/rules-loader.js";
export {
	ConfigurationResolutionError,
	loadRules,
} from "./rules/rules-loader.js";
export { formatStandardsSettingsDiagnostic } from "./settings/settings-diagnostic.js";
export { resolveStandardsSettingsPath } from "./settings/settings-file-location.js";
export {
	readStandardsSettingsFile,
	StandardsSettingsLoadError,
} from "./settings/settings-loader.js";
export type { StandardsSettings } from "./settings/settings-schema.js";
