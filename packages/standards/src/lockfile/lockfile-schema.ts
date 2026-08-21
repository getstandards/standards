import { z } from "zod/v4";
import {
	branchRevisionSchema,
	commitObjectIdSchema,
	repositoryUrlSchema,
	tagRevisionSchema,
} from "../config/configuration-schema.js";

/** A tag or branch revision recorded in the lock file. */
export const mutableRevisionSchema = z.union([
	tagRevisionSchema,
	branchRevisionSchema,
]);

/** One resolved mutable Git source. */
export const sourceLockSchema = z
	.object({
		repository: repositoryUrlSchema,
		revision: mutableRevisionSchema,
		commit: commitObjectIdSchema,
	})
	.strict();

/** A validated tag or branch revision. */
export type MutableRevision = z.infer<typeof mutableRevisionSchema>;

/** Return the type and name of a mutable revision. */
export function mutableRevisionParts(revision: MutableRevision): {
	type: "tag" | "branch";
	name: string;
} {
	return "tag" in revision
		? { type: "tag", name: revision.tag }
		: { type: "branch", name: revision.branch };
}

/** Return the unique key for a mutable revision of one repository. */
export function mutableRevisionKey(
	repository: string,
	revision: MutableRevision,
): string {
	const { type, name } = mutableRevisionParts(revision);
	return `${repository}\u0000${type}\u0000${name}`;
}

/** Return the unique key for one lock-file source. */
export function sourceLockKey(sourceLock: SourceLock): string {
	return mutableRevisionKey(sourceLock.repository, sourceLock.revision);
}

/** The validated shape of a version 1 Standards lock document. */
export const lockfileSchema = z
	.object({
		version: z.literal(1),
		sources: z.array(sourceLockSchema),
	})
	.strict()
	.superRefine((lockfile, context) => {
		const sourceIndexes = new Map<string, number>();
		for (const [index, source] of lockfile.sources.entries()) {
			const key = sourceLockKey(source);
			const previousIndex = sourceIndexes.get(key);
			if (previousIndex !== undefined) {
				context.addIssue({
					code: "custom",
					path: ["sources", index],
					message: `Source lock duplicates sources[${previousIndex}].`,
				});
				continue;
			}
			sourceIndexes.set(key, index);
		}
	});

/** A validated Standards lock file. */
export type Lockfile = z.infer<typeof lockfileSchema>;

/** One source in a validated Standards lock file. */
export type SourceLock = z.infer<typeof sourceLockSchema>;
