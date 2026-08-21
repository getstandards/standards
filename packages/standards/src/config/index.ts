export {
	ConfigurationLoadError,
	loadConfiguration,
} from "./configuration-loader.js";
export {
	ConfigurationResolutionError,
	loadLocalRules,
	loadRules,
} from "./configuration-resolver.js";
export type {
	Configuration,
	ExtensionSource,
	GitRevision,
	Rule,
} from "./configuration-schema.js";
export {
	branchRevisionSchema,
	commitObjectIdSchema,
	configurationSchema,
	extensionSourceSchema,
	gitRevisionSchema,
	repositoryUrlSchema,
	requirementLevels,
	ruleSchema,
	tagRevisionSchema,
} from "./configuration-schema.js";
