import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { ResolveConfigurationOptions } from "../config/configuration-resolver.js";
import {
	canonicalizeRepositoryRoot,
	resolveConfigurationGraph,
} from "../config/configuration-resolver.js";
import { commitObjectIdSchema } from "../config/configuration-schema.js";
import { errorMessage, isMissingFileError } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import type {
	Lockfile,
	MutableRevision,
	SourceLock,
} from "./lockfile-schema.js";
import {
	mutableRevisionKey,
	mutableRevisionParts,
	sourceLockKey,
} from "./lockfile-schema.js";

const LOCK_FILE_NAME = ".standards.lock";

/** A failure while resolving or writing a Standards lock file. */
export class LockfileUpdateError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "LockfileUpdateError";
	}
}

/** The result of one lock-file update. */
export interface LockfileUpdateResult {
	repositoryRoot: string;
	lockfilePath: string;
	lockfile: Lockfile;
	changed: boolean;
}

/** Resolve an exact remote tag or branch reference to a commit. */
async function resolveRemoteRevision(
	repository: string,
	revision: MutableRevision,
	workingDirectory: string,
): Promise<string> {
	const { type, name } = mutableRevisionParts(revision);
	const reference = type === "tag" ? `refs/tags/${name}` : `refs/heads/${name}`;
	const requestedReferences =
		type === "tag" ? [reference, `${reference}^{}`] : [reference];

	let output: string;
	try {
		output = await runGit(
			["ls-remote", repository, ...requestedReferences],
			workingDirectory,
		);
	} catch (error) {
		throw new LockfileUpdateError(
			`Cannot query Git repository '${repository}': ${errorMessage(error)}`,
		);
	}

	const references = new Map<string, string>();
	for (const line of output.split("\n")) {
		if (line === "") {
			continue;
		}
		const [objectId, name] = line.split("\t");
		if (objectId !== undefined && name !== undefined) {
			references.set(name, objectId);
		}
	}

	const objectId =
		references.get(`${reference}^{}`) ?? references.get(reference);
	if (objectId === undefined) {
		throw new LockfileUpdateError(
			`Git ${type} '${name}' does not exist in '${repository}'.`,
		);
	}

	const result = commitObjectIdSchema.safeParse(objectId);
	if (!result.success) {
		throw new LockfileUpdateError(
			`Git reference '${reference}' from '${repository}' returned invalid object ID '${objectId}'.`,
		);
	}
	return result.data.toLowerCase();
}

/** Compare text using stable code-point order. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

/** Sort lock entries by repository, revision type, and revision value. */
function compareSourceLocks(left: SourceLock, right: SourceLock): number {
	return compareText(sourceLockKey(left), sourceLockKey(right));
}

/** Read a file when it exists. */
async function readOptionalFile(
	candidatePath: string,
): Promise<string | undefined> {
	try {
		return await readFile(candidatePath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw new LockfileUpdateError(
			`Cannot read lock file '${candidatePath}': ${errorMessage(error)}`,
		);
	}
}

/** Replace a file through a temporary sibling file. */
async function writeFileAtomically(
	targetPath: string,
	content: string,
): Promise<void> {
	const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, content, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o644,
		});
		await rename(temporaryPath, targetPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

/** Resolve mutable Git sources and update the root Standards lock file. */
export async function updateLockfile(
	repositoryRoot: string,
	options: ResolveConfigurationOptions = {},
): Promise<LockfileUpdateResult> {
	const canonicalRepositoryRoot =
		await canonicalizeRepositoryRoot(repositoryRoot);

	const sourceLocks = new Map<string, SourceLock>();
	await resolveConfigurationGraph(
		canonicalRepositoryRoot,
		async (repository, revision) => {
			const key = mutableRevisionKey(repository, revision);
			const existing = sourceLocks.get(key);
			if (existing !== undefined) {
				return existing.commit;
			}

			options.reportProgress?.reportResolvingRevision(repository, revision);
			const commit = await resolveRemoteRevision(
				repository,
				revision,
				canonicalRepositoryRoot,
			);
			sourceLocks.set(key, { repository, revision, commit });
			return commit;
		},
		options,
	);

	const lockfile: Lockfile = {
		version: 1,
		sources: [...sourceLocks.values()].sort(compareSourceLocks),
	};
	const content = `---\n${stringify(lockfile, { lineWidth: 0 })}`;
	const lockfilePath = path.join(canonicalRepositoryRoot, LOCK_FILE_NAME);
	const previousContent = await readOptionalFile(lockfilePath);
	const changed = previousContent !== content;
	if (changed) {
		await writeFileAtomically(lockfilePath, content);
	}

	return {
		repositoryRoot: canonicalRepositoryRoot,
		lockfilePath,
		lockfile,
		changed,
	};
}
