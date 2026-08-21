import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { z } from "zod/v4";

/** Model providers built into the pi AI SDK used by Standards. */
export const KNOWN_MODEL_PROVIDERS = builtinProviders()
	.map((provider) => provider.id)
	.sort((left, right) => left.localeCompare(right));

const knownModelProviderSet = new Set<string>(KNOWN_MODEL_PROVIDERS);
const modelReferenceError = `Expected a model reference in '<provider>/<model>' form. Known providers: ${KNOWN_MODEL_PROVIDERS.join(
	", ",
)}.`;

/** A provider and model identifier in `<provider>/<model>` form. */
export const modelReferenceSchema = z
	.string()
	.superRefine((modelReference, context) => {
		const separatorIndex = modelReference.indexOf("/");
		if (separatorIndex <= 0) {
			context.addIssue({ code: "custom", message: modelReferenceError });
			return;
		}
		const provider = modelReference.slice(0, separatorIndex);
		const model = modelReference.slice(separatorIndex + 1);
		if (model.length === 0 || !knownModelProviderSet.has(provider)) {
			context.addIssue({ code: "custom", message: modelReferenceError });
		}
	})
	.brand<"ModelReference">();

/** A validated model reference used by one or both review agent steps. */
export type ModelReference = z.infer<typeof modelReferenceSchema>;

/** The provider name and model identifier split from a model reference. */
export interface ModelReferenceParts {
	provider: string;
	model: string;
}

/** Split a validated model reference into its provider name and model identifier. */
export function parseModelReference(
	modelReference: ModelReference,
): ModelReferenceParts {
	const separatorIndex = modelReference.indexOf("/");
	return {
		provider: modelReference.slice(0, separatorIndex),
		model: modelReference.slice(separatorIndex + 1),
	};
}
