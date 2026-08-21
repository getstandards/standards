import { z } from "zod/v4";

const COMMIT_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
/** The stable lowercase rule identifier format (specs/configuration.md). */
export const RULE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const FORBIDDEN_GIT_REFERENCE_CHARACTERS = "~^:?*[\\";

/** The levels defined by RFC 2119 and supported by configuration version 1. */
export const requirementLevels = [
	"MUST",
	"MUST NOT",
	"SHOULD",
	"SHOULD NOT",
	"MAY",
] as const;

/** A full SHA-1 or SHA-256 Git commit object ID. */
export const commitObjectIdSchema = z
	.string()
	.regex(
		COMMIT_OBJECT_ID_PATTERN,
		"Expected a full 40-character or 64-character Git commit object ID.",
	);

/** An HTTPS Git repository URL without embedded credentials. */
export const repositoryUrlSchema = z
	.url()
	.superRefine((repository, context) => {
		const parsedRepository = new URL(repository);
		if (!repository.startsWith("https://")) {
			context.addIssue({
				code: "custom",
				message: "Expected an HTTPS repository URL.",
			});
		}

		if (parsedRepository.username !== "" || parsedRepository.password !== "") {
			context.addIssue({
				code: "custom",
				message: "Repository URLs must not contain credentials.",
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

const commitRevisionSchema = z
	.object({ commit: commitObjectIdSchema })
	.strict();

/** A Git tag revision without the `refs/tags/` prefix. */
export const tagRevisionSchema = z
	.object({
		tag: z
			.string()
			.refine(
				(tag) => !tag.startsWith("refs/tags/") && isValidGitReferenceName(tag),
				"Expected a valid tag name without the refs/tags/ prefix.",
			),
	})
	.strict();

/** A Git branch revision without the `refs/heads/` prefix. */
export const branchRevisionSchema = z
	.object({
		branch: z
			.string()
			.refine(
				(branch) =>
					!branch.startsWith("-") &&
					!branch.startsWith("refs/heads/") &&
					isValidGitReferenceName(branch),
				"Expected a valid branch name without the refs/heads/ prefix.",
			),
	})
	.strict();

/** A commit, tag, or branch selected by a Git extension source. */
export const gitRevisionSchema = z.union([
	commitRevisionSchema,
	tagRevisionSchema,
	branchRevisionSchema,
]);

const localExtensionSourceSchema = z
	.object({ path: relativePathSchema })
	.strict();

const gitExtensionSourceSchema = z
	.object({
		git: z
			.object({
				repository: repositoryUrlSchema,
				revision: gitRevisionSchema,
				path: relativePathSchema,
			})
			.strict(),
	})
	.strict();

/** A local or Git configuration source in an `extends` list. */
export const extensionSourceSchema = z.union([
	localExtensionSourceSchema,
	gitExtensionSourceSchema,
]);

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
		"Expected a repository-relative glob that uses version 1 syntax.",
	);

const appliesToSchema = z
	.object({
		include: z.array(globSchema).min(1).optional(),
		exclude: z.array(globSchema).min(1).optional(),
	})
	.strict();

/** A rule that can be evaluated during pull request review. */
export const ruleSchema = z
	.object({
		id: z
			.string()
			.regex(RULE_ID_PATTERN, "Expected a stable lowercase rule identifier."),
		level: z.enum(requirementLevels),
		description: z.string(),
		rationale: z.string(),
		applies_to: appliesToSchema.optional(),
		guidance: z.string().optional(),
		references: z.array(z.string()).optional(),
	})
	.strict();

/** The validated shape of a version 1 Standards configuration document. */
export const configurationSchema = z
	.object({
		version: z.literal(1),
		name: z.string().optional(),
		description: z.string().optional(),
		extends: z.array(extensionSourceSchema).default([]),
		rules: z.array(ruleSchema).default([]),
	})
	.strict()
	.superRefine((configuration, context) => {
		const ruleIndexes = new Map<string, number>();
		for (const [index, rule] of configuration.rules.entries()) {
			const previousIndex = ruleIndexes.get(rule.id);
			if (previousIndex !== undefined) {
				context.addIssue({
					code: "custom",
					path: ["rules", index, "id"],
					message: `Rule ID '${rule.id}' duplicates rules[${previousIndex}].id.`,
				});
				continue;
			}
			ruleIndexes.set(rule.id, index);
		}
	});

/** A validated Standards configuration. */
export type Configuration = z.infer<typeof configurationSchema>;

/** A rule from a validated Standards configuration. */
export type Rule = z.infer<typeof ruleSchema>;

/** A source from a validated configuration `extends` list. */
export type ExtensionSource = z.infer<typeof extensionSourceSchema>;

/** A Git revision from a validated Git extension source. */
export type GitRevision = z.infer<typeof gitRevisionSchema>;
