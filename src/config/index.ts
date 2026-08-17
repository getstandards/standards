export { ConfigurationLoadError, loadConfiguration } from "./loader.js";
export {
	ConfigurationResolutionError,
	loadLocalRules,
	loadRules,
} from "./resolver.js";
export type {
	Configuration,
	ExtensionSource,
	GitRevision,
	Rule,
} from "./schema.js";
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
} from "./schema.js";
