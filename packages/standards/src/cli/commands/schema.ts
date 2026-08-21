import {
	readSchemaFile,
	type SchemaTarget,
} from "../../schema/schema-files.js";
import { errorMessage } from "../../utils/errors.js";
import type { CommandContext } from "../cli-context.js";

/** Print a bundled JSON Schema file to standard output. */
export async function runSchemaCommand(
	{ output }: CommandContext,
	target: SchemaTarget = "config",
): Promise<number> {
	try {
		const contents = await readSchemaFile(target);
		output.log(contents.trimEnd());
		return 0;
	} catch (error) {
		output.error(`Cannot read the ${target} schema: ${errorMessage(error)}`);
		return 1;
	}
}
