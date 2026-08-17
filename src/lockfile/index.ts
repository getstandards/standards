export { LockfileLoadError, loadLockfile } from "./loader.js";
export type { Lockfile, SourceLock } from "./schema.js";
export {
	lockfileSchema,
	mutableRevisionSchema,
	sourceLockSchema,
} from "./schema.js";
export type { LockfileUpdateResult } from "./updater.js";
export { LockfileUpdateError, updateLockfile } from "./updater.js";
