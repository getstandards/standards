import type {
	AppliesTo,
	RequirementLevel,
} from "../config/configuration-schema.js";

/**
 * One rule resolved from a knowledge document (specs/configuration.md).
 *
 * `title` is the rule statement, `description` an optional one-line summary,
 * and `body` the full markdown body that carries the rationale. `folder` is
 * the mapped folder that produced the rule, which `standards review --folder`
 * filters on. `applies_to` is the target file filter from the folder mapping.
 * The rule carries only the fields that selection, review, or reporting use.
 */
export interface Rule {
	id: string;
	level: RequirementLevel;
	folder: string;
	title: string;
	description?: string;
	body: string;
	applies_to?: AppliesTo;
}
