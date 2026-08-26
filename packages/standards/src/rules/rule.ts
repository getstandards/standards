import type {
	AppliesTo,
	RequirementLevel,
} from "../config/configuration-schema.js";

/**
 * One rule resolved from a knowledge document (specs/configuration.md).
 *
 * `title` is the rule statement, `description` a one-line summary, and `body`
 * the full markdown body that carries the rationale. `aliases` holds the
 * derived ids of superseded documents; a suppression marker that names an
 * alias suppresses this rule.
 */
export interface Rule {
	id: string;
	level: RequirementLevel;
	title: string;
	description: string;
	body: string;
	applies_to?: AppliesTo;
	type?: string;
	tags: string[];
	aliases: string[];
}
