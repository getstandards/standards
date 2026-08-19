import { describe, expect, it } from "vitest";
import { modelReferenceSchema } from "./model-reference.js";

describe("modelReferenceSchema", () => {
	it("accepts a dynamic provider registered by pi-ai", () => {
		expect(modelReferenceSchema.safeParse("radius/local-model").success).toBe(
			true,
		);
	});
});
