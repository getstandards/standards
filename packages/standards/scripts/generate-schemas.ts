// Regenerate the committed JSON Schema files from the Zod schemas:
//   pnpm generate:schemas
// The schemas are structural only; Zod refinements (semantic checks) are
// dropped by z.toJSONSchema. See src/schema/schema-drift.test.ts for the
// drift and freshness tests that keep the files in sync.
import { writeGeneratedSchemas } from "../src/schema/schema-generation.js";

await writeGeneratedSchemas();
console.log(
	"Generated schemas/v1/standards.schema.json and schemas/v1/standards-lock.schema.json",
);
