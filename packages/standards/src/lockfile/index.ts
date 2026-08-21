export { LockfileLoadError, loadLockfile } from "./lockfile-loader.js";
export type { Lockfile, SourceLock } from "./lockfile-schema.js";
export {
	lockfileSchema,
	mutableRevisionSchema,
	sourceLockSchema,
} from "./lockfile-schema.js";
export type { LockfileUpdateResult } from "./lockfile-updater.js";
export { LockfileUpdateError, updateLockfile } from "./lockfile-updater.js";
