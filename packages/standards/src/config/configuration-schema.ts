import { z } from "zod/v4";

const COMMIT_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
/** The stable lowercase rule identifier format (specs/configuration.md). */
export const RULE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const FORBIDDEN_GIT_REFERENCE_CHARACTERS = "~^:?*[\\";
const SCP_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+$/;

/** The requirement levels a folder mapping accepts (specs/configuration.md). */
export const requirementLevels = ["MUST", "SHOULD"] as const;

/** The requirement level of a rule: blocking or advisory. */
export type RequirementLevel = (typeof requirementLevels)[number];

/** A full SHA-1 or SHA-256 Git commit object ID. */
export const commitObjectIdSchema = z
	.string()
	.regex(
		COMMIT_OBJECT_ID_PATTERN,
		"Expected a full 40-character or 64-character Git commit object ID.",
	);

/** Return true when a value is an HTTPS repository URL without credentials. */
function isValidHttpsRepositoryUrl(repository: string): boolean {
	let parsedRepository: URL;
	try {
		parsedRepository = new URL(repository);
	} catch {
		return false;
	}
	return (
		repository.startsWith("https://") &&
		parsedRepository.username === "" &&
		parsedRepository.password === ""
	);
}

/** Return true when a value is an `ssh://` or scp-form repository URL. */
function isValidSshRepositoryUrl(repository: string): boolean {
	if (repository.startsWith("ssh://")) {
		try {
			new URL(repository);
			return true;
		} catch {
			return false;
		}
	}
	return SCP_REPOSITORY_PATTERN.test(repository);
}

/**
 * An HTTPS repository URL without embedded credentials, or an SSH repository
 * URL in `ssh://` or scp form (specs/configuration.md).
 */
export const repositoryUrlSchema = z
	.string()
	.superRefine((repository, context) => {
		if (repository.startsWith("https://")) {
			if (!isValidHttpsRepositoryUrl(repository)) {
				context.addIssue({
					code: "custom",
					message:
						"Expected an HTTPS repository URL without embedded credentials.",
				});
			}
			return;
		}
		if (!isValidSshRepositoryUrl(repository)) {
			context.addIssue({
				code: "custom",
				message:
					"Expected an HTTPS repository URL, or an SSH repository URL in ssh:// or scp form.",
			});
		}
	});

const relativePathSchema = z
	.string()
	.min(1, "Expected a non-empty relative path.")
	.refine(
		(path) =>
			!path.startsWith("/") && !WINDOWS_ABSOLUTE_PATH_PATTERN.test(path),
		"Expected a relative path.",
	);

/** Return true when a value follows the Git reference name grammar. */
function isValidGitReferenceName(referenceName: string): boolean {
	const containsForbiddenCharacter = [...referenceName].some((character) => {
		const codePoint = character.codePointAt(0);
		return (
			codePoint === undefined ||
			codePoint <= 0x20 ||
			codePoint === 0x7f ||
			FORBIDDEN_GIT_REFERENCE_CHARACTERS.includes(character)
		);
	});

	if (
		referenceName.length === 0 ||
		referenceName.startsWith("/") ||
		referenceName.endsWith("/") ||
		referenceName.endsWith(".") ||
		referenceName.includes("//") ||
		referenceName.includes("..") ||
		referenceName.includes("@{") ||
		referenceName === "@" ||
		containsForbiddenCharacter
	) {
		return false;
	}

	return referenceName
		.split("/")
		.every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

/** A Git branch name without the `refs/heads/` prefix. */
export const branchNameSchema = z
	.string()
	.refine(
		(branch) =>
			!branch.startsWith("-") &&
			!branch.startsWith("refs/heads/") &&
			isValidGitReferenceName(branch),
		"Expected a valid branch name without the refs/heads/ prefix.",
	);

/** Return true when a character can be an endpoint in a version 1 range. */
function isValidCharacterClassEndpoint(character: string): boolean {
	return !"-/[]{}*?".includes(character);
}

/** Return true when a character class uses only version 1 syntax. */
function isValidCharacterClass(characterClass: string): boolean {
	if (
		characterClass.length === 0 ||
		characterClass.startsWith("!") ||
		characterClass.startsWith("^")
	) {
		return false;
	}

	let index = 0;
	while (index < characterClass.length) {
		const rangeStart = characterClass[index];
		if (
			rangeStart === undefined ||
			!isValidCharacterClassEndpoint(rangeStart)
		) {
			return false;
		}

		if (characterClass[index + 1] === "-") {
			const rangeEnd = characterClass[index + 2];
			if (rangeEnd === undefined || !isValidCharacterClassEndpoint(rangeEnd)) {
				return false;
			}
			index += 3;
			continue;
		}

		index += 1;
	}

	return true;
}

/** Return true when a glob path segment uses version 1 syntax. */
function isValidGlobSegment(segment: string, allowBraces: boolean): boolean {
	if (segment.length === 0) {
		return false;
	}

	if (segment.includes("**")) {
		return segment === "**";
	}

	for (let index = 0; index < segment.length; index += 1) {
		const character = segment[index];
		if (character === "[") {
			const endIndex = segment.indexOf("]", index + 1);
			if (
				endIndex === -1 ||
				!isValidCharacterClass(segment.slice(index + 1, endIndex))
			) {
				return false;
			}
			index = endIndex;
			continue;
		}

		if (character === "{") {
			const endIndex = segment.indexOf("}", index + 1);
			if (
				!allowBraces ||
				endIndex === -1 ||
				!isValidBraceExpression(segment.slice(index + 1, endIndex))
			) {
				return false;
			}
			index = endIndex;
			continue;
		}

		if (character === "]" || character === "}") {
			return false;
		}
	}

	return true;
}

/** Return true when a brace expression uses comma-separated alternatives. */
function isValidBraceExpression(braceExpression: string): boolean {
	const alternatives = braceExpression.split(",");
	return (
		alternatives.length >= 2 &&
		alternatives.every((alternative) => isValidGlobSegment(alternative, false))
	);
}

/** Return true when a glob uses only the syntax defined by version 1. */
function isValidVersionOneGlob(glob: string): boolean {
	if (glob.length === 0 || glob.startsWith("/") || glob.includes("\\")) {
		return false;
	}

	return glob
		.split("/")
		.every(
			(segment) =>
				segment !== "." &&
				segment !== ".." &&
				isValidGlobSegment(segment, true),
		);
}

const globSchema = z
	.string()
	.refine(
		isValidVersionOneGlob,
		"Invalid glob. Use '/' separators and '**' only as a whole path segment, for example 'dir/**/*.md'.",
	);

/** The `include`/`exclude` glob filter that scopes a rule to files. */
export const appliesToSchema = z
	.object({
		include: z.array(globSchema).min(1).optional(),
		exclude: z.array(globSchema).min(1).optional(),
	})
	.strict();

/** A validated `applies_to` filter. */
export type AppliesTo = z.infer<typeof appliesToSchema>;

/**
 * The `include`/`exclude` glob filter that selects knowledge documents inside a
 * mapped folder. Its globs are relative to the mapped folder
 * (specs/configuration.md).
 */
export const documentFilterSchema = z
	.object({
		include: z.array(globSchema).min(1).optional(),
		exclude: z.array(globSchema).min(1).optional(),
	})
	.strict();

/** A validated knowledge document filter. */
export type DocumentFilter = z.infer<typeof documentFilterSchema>;

/**
 * A rule id prefix added to every derived id of a source. It matches the rule
 * id grammar without a final dot (specs/configuration.md).
 */
export const idPrefixSchema = z
	.string()
	.regex(
		RULE_ID_PATTERN,
		"Expected an id prefix that matches the rule id grammar.",
	);

/** A bundle-relative folder path with `/` separators and no `.` segments. */
const folderSchema = relativePathSchema.refine(
	(folder) =>
		!folder.includes("\\") &&
		!folder.endsWith("/") &&
		folder
			.split("/")
			.every(
				(segment) => segment !== "" && segment !== "." && segment !== "..",
			),
	"Expected a bundle-relative folder path without '.' or '..' segments.",
);

/** The expanded folder mapping form: a level with optional filters. */
const expandedFolderMappingSchema = z
	.object({
		level: z.enum(requirementLevels),
		documents: documentFilterSchema.optional(),
		applies_to: appliesToSchema.optional(),
	})
	.strict();

/**
 * One folder mapping value: a bare requirement level (short form) or a level
 * with optional document and target file filters (expanded form).
 */
const folderMappingValueSchema = z.union([
	z.enum(requirementLevels),
	expandedFolderMappingSchema,
]);

/** One normalized folder mapping of a knowledge source. */
export interface FolderMapping {
	folder: string;
	level: RequirementLevel;
	documents?: DocumentFilter;
	applies_to?: AppliesTo;
}

/** Return true when one mapped folder contains or equals another. */
function foldersOverlap(first: string, second: string): boolean {
	return (
		first === second ||
		first.startsWith(`${second}/`) ||
		second.startsWith(`${first}/`)
	);
}

/**
 * The `folders` object of a source, mapping each folder to its level or
 * expanded form. It normalizes to an ordered list of folder mappings and
 * rejects an empty object or two overlapping folders.
 */
const foldersSchema = z
	.record(folderSchema, folderMappingValueSchema)
	.superRefine((folders, context) => {
		const names = Object.keys(folders);
		if (names.length === 0) {
			context.addIssue({
				code: "custom",
				message: "Expected at least one folder mapping.",
			});
		}
		for (const [index, name] of names.entries()) {
			const overlap = names.find(
				(other, otherIndex) =>
					otherIndex < index && foldersOverlap(other, name),
			);
			if (overlap !== undefined) {
				context.addIssue({
					code: "custom",
					path: [name],
					message: `Folder '${name}' overlaps folder '${overlap}' of the same source.`,
				});
			}
		}
	})
	.transform((folders): FolderMapping[] =>
		Object.entries(folders).map(([folder, mapping]) => {
			if (typeof mapping === "string") {
				return { folder, level: mapping };
			}
			const normalized: FolderMapping = { folder, level: mapping.level };
			if (mapping.documents !== undefined) {
				normalized.documents = mapping.documents;
			}
			if (mapping.applies_to !== undefined) {
				normalized.applies_to = mapping.applies_to;
			}
			return normalized;
		}),
	);

const localSourceSchema = z
	.object({
		path: relativePathSchema,
		id_prefix: idPrefixSchema.optional(),
		folders: foldersSchema,
	})
	.strict();

const gitSourceSchema = z
	.object({
		repository: repositoryUrlSchema,
		branch: branchNameSchema.optional(),
		path: relativePathSchema.optional(),
		id_prefix: idPrefixSchema.optional(),
		folders: foldersSchema,
	})
	.strict();

/** A local or Git knowledge source in the configuration `sources` list. */
export const knowledgeSourceSchema = z.union([
	localSourceSchema,
	gitSourceSchema,
]);

/** The validated shape of a version 2 Standards configuration document. */
export const configurationSchema = z
	.object({
		version: z.literal(2),
		sources: z.array(knowledgeSourceSchema).default([]),
	})
	.strict();

/** A validated Standards configuration. */
export type Configuration = z.infer<typeof configurationSchema>;

/** A source from a validated configuration `sources` list. */
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

/** A Git source from a validated configuration `sources` list. */
export type GitKnowledgeSource = z.infer<typeof gitSourceSchema>;

/** A local source from a validated configuration `sources` list. */
export type LocalKnowledgeSource = z.infer<typeof localSourceSchema>;
