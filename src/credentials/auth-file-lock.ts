import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { errorMessage } from "../utils/errors.js";

/** The suffix of the lock file that guards one credential file. */
const AUTH_FILE_LOCK_SUFFIX = ".lock";

/** Wait this long, in milliseconds, before a lock attempt is abandoned. */
const AUTH_FILE_LOCK_TIMEOUT_MS = 10_000;

/** Treat a lock older than this many milliseconds as abandoned by a dead process. */
const AUTH_FILE_LOCK_STALE_MS = 60_000;

/** Wait this long, in milliseconds, between lock attempts. */
const AUTH_FILE_LOCK_RETRY_MS = 50;

/** An error raised when the credential file lock cannot be acquired. */
export class AuthFileLockError extends Error {
	public constructor(
		public readonly lockPath: string,
		public readonly problem: string,
	) {
		super(`Standards credential lock failed at ${lockPath}: ${problem}`);
		this.name = "AuthFileLockError";
	}
}

/** Return whether a thrown value reports that a lock file already exists. */
function isLockHeldError<Thrown>(thrown: Thrown): boolean {
	return (
		typeof thrown === "object" &&
		thrown !== null &&
		"code" in thrown &&
		thrown.code === "EEXIST"
	);
}

/** Remove a lock file whose age is past the stale threshold. */
async function removeStaleAuthFileLock(lockPath: string): Promise<void> {
	try {
		const lockStat = await stat(lockPath);
		if (Date.now() - lockStat.mtimeMs > AUTH_FILE_LOCK_STALE_MS) {
			await rm(lockPath, { force: true });
		}
	} catch {
		// The lock disappeared or cannot be inspected; the next attempt decides.
	}
}

/**
 * Hold an exclusive lock on the credential file while `operation` runs.
 *
 * The lock is a sibling `auth.json.lock` file created with an exclusive open,
 * so it works across Standards processes that share the credential file. This
 * stops concurrent requests from refreshing the same rotating OAuth token
 * twice. A lock left by a dead process is removed after it goes stale.
 */
export async function withAuthFileLock<Result>(
	authFilePath: string,
	operation: () => Promise<Result>,
): Promise<Result> {
	const lockPath = `${authFilePath}${AUTH_FILE_LOCK_SUFFIX}`;
	await mkdir(path.dirname(lockPath), { recursive: true });

	const deadline = Date.now() + AUTH_FILE_LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			const handle = await open(lockPath, "wx");
			await handle.close();
			break;
		} catch (error) {
			if (!isLockHeldError(error)) {
				throw new AuthFileLockError(lockPath, errorMessage(error));
			}
			if (Date.now() >= deadline) {
				throw new AuthFileLockError(
					lockPath,
					"Timed out while waiting for another Standards process to release the lock.",
				);
			}
			await removeStaleAuthFileLock(lockPath);
			await delay(AUTH_FILE_LOCK_RETRY_MS);
		}
	}

	try {
		return await operation();
	} finally {
		await rm(lockPath, { force: true });
	}
}
