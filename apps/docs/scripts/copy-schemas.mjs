// Copy the bundled JSON Schema files into the public directory so the
// built site serves them at the canonical URLs:
//   https://getstandards.dev/schemas/v1/standards.schema.json
//   https://getstandards.dev/schemas/v1/standards-lock.schema.json
// Run before `astro dev` and `astro build` (see the predev/prebuild scripts).
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_DIR = 'node_modules/@getstandards/standards/schemas/v1';
const DEST_DIR = 'public/schemas/v1';

await rm(DEST_DIR, { recursive: true, force: true });
await mkdir(DEST_DIR, { recursive: true });

for (const file of await readdir(SOURCE_DIR)) {
	await cp(join(SOURCE_DIR, file), join(DEST_DIR, file));
}

console.log(`Copied JSON Schemas to ${DEST_DIR}.`);