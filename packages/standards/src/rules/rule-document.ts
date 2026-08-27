import { z } from "zod/v4";
import { errorMessage } from "../utils/errors.js";
import { parseSingleYamlDocument } from "../utils/yaml.js";

/** The lifecycle states of a knowledge document (specs/configuration.md). */
export const documentStatuses = ["draft", "stable", "deprecated"] as const;

/** The ADR lifecycle states a knowledge document can carry. */
export const adrStatuses = [
	"proposed",
	"accepted",
	"rejected",
	"deprecated",
	"superseded",
] as const;

/**
 * The frontmatter fields that Standards reads from a knowledge document.
 *
 * Unknown fields are accepted and ignored. An absent field gets its default;
 * a present but invalid field makes the whole document invalid
 * (specs/configuration.md).
 */
const frontmatterSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	status: z.enum(documentStatuses).default("stable"),
	adr_status: z.enum(adrStatuses).optional(),
	superseded_by: z.string().min(1).optional(),
});

/** The validated frontmatter of one knowledge document. */
export type RuleFrontmatter = z.infer<typeof frontmatterSchema>;

/** A parsed knowledge document, or the problem that makes it invalid. */
export type ParsedRuleDocument =
	| { ok: true; frontmatter: RuleFrontmatter; body: string }
	| { ok: false; problem: string };

/** Format the field path of a frontmatter validation issue. */
function formatIssuePath(path: readonly PropertyKey[]): string {
	let fieldPath = "";
	for (const part of path) {
		if (typeof part === "number") {
			fieldPath += `[${part}]`;
			continue;
		}
		fieldPath += fieldPath === "" ? String(part) : `.${String(part)}`;
	}
	return fieldPath;
}

/**
 * Parse one knowledge document into its frontmatter and markdown body.
 *
 * It returns a problem instead of throwing: a bad document is skipped with a
 * warning and must never break a review (specs/configuration.md).
 */
export function parseRuleDocument(sourceText: string): ParsedRuleDocument {
	const lines = sourceText.split("\n");
	if (lines[0]?.trimEnd() !== "---") {
		return { ok: false, problem: "The document has no frontmatter block." };
	}

	const closeIndex = lines.findIndex(
		(line, index) => index > 0 && line.trimEnd() === "---",
	);

	if (closeIndex === -1) {
		return {
			ok: false,
			problem: "The frontmatter block is not closed with '---'.",
		};
	}

	const frontmatterText = lines.slice(1, closeIndex).join("\n");
	let frontmatterValue: unknown;
	// An empty frontmatter block is a document with every field absent.
	if (frontmatterText.trim() !== "") {
		try {
			frontmatterValue = parseSingleYamlDocument(frontmatterText);
		} catch (error) {
			return {
				ok: false,
				problem: `The frontmatter is not valid YAML: ${errorMessage(error)}`,
			};
		}
	}

	const result = frontmatterSchema.safeParse(frontmatterValue ?? {});
	if (!result.success) {
		const issue = result.error.issues[0];
		const fieldPath = issue === undefined ? "" : formatIssuePath(issue.path);
		const field = fieldPath === "" ? "frontmatter" : `'${fieldPath}'`;
		return {
			ok: false,
			problem: `Invalid frontmatter field ${field}: ${issue?.message ?? "invalid value"}.`,
		};
	}

	return {
		ok: true,
		frontmatter: result.data,
		body: lines
			.slice(closeIndex + 1)
			.join("\n")
			.trim(),
	};
}
