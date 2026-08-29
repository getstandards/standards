import { z } from "zod/v4";
import { modelReferenceSchema } from "../review/model-reference.js";

/** The validated shape of a version 1 Standards settings document. */
export const standardsSettingsSchema = z
	.object({
		version: z.literal(1),
		cache_dir: z
			.string()
			.min(1, "Expected a non-empty cache directory path.")
			.optional(),
		model: modelReferenceSchema.optional(),
		evaluation_model: modelReferenceSchema.optional(),
		verification_model: modelReferenceSchema.optional(),
		concurrency: z
			.int("Expected an integer greater than or equal to 1.")
			.min(1, "Expected an integer greater than or equal to 1.")
			.optional(),
	})
	.strict();

/** Personal defaults from a validated Standards settings document. */
export type StandardsSettings = z.infer<typeof standardsSettingsSchema>;
