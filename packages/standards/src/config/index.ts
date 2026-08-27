export {
	ConfigurationLoadError,
	loadConfiguration,
} from "./configuration-loader.js";
export type {
	AppliesTo,
	AppliesToEntry,
	Configuration,
	DocumentFilter,
	FolderMapping,
	GitKnowledgeSource,
	KnowledgeSource,
	LocalKnowledgeSource,
	RequirementLevel,
} from "./configuration-schema.js";
export {
	appliesToEntrySchema,
	appliesToSchema,
	branchNameSchema,
	commitObjectIdSchema,
	configurationSchema,
	documentFilterSchema,
	idPrefixSchema,
	knowledgeSourceSchema,
	repositoryUrlSchema,
	requirementLevels,
} from "./configuration-schema.js";
