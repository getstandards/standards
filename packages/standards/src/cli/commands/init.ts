import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import figures from "figures";
import { stringify } from "yaml";
import {
	configurationSchema,
	RULE_ID_PATTERN,
	requirementLevels,
} from "../../config/configuration-schema.js";
import type { Configuration, Rule } from "../../config/index.js";
import type { CommandContext } from "../cli-context.js";

const ENTRY_FILE_NAME = ".standards.yml";

/** The comment block placed above every generated configuration. */
const CONFIG_HEADER = `# Standards configuration for this repository.
#
# Extend rules from another configuration:
# extends:
#   - path: ../shared/standards.yml
#
# Or from a Git repository:
# extends:
#   - git:
#       repository: https://github.com/your-org/shared-standards.git
#       revision:
#         tag: v1.0.0
#       path: standards.yml
#
# Define your own rules with an 'id', a 'level' (MUST, MUST NOT, SHOULD,
# SHOULD NOT, or MAY), a 'description' and a 'rationale':
# rules:
#   - id: example.no-float-money
#     level: MUST NOT
#     description: Do not store money as a floating-point number.
#     rationale: Floating-point money loses cents.
#     applies_to:
#       include:
#         - "**/*.ts"
`;

/** Return true when a candidate path is accessible. */
async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create the entry file for a repository that has none (specs/cli.md init).
 *
 * On an interactive terminal it asks how to start, and can capture one first
 * rule. Without a terminal it writes a version 1 configuration with an empty
 * rule set and commented examples. It never creates a lock file, and it
 * validates the generated configuration before writing it.
 */
export async function runInitCommand(context: CommandContext): Promise<number> {
	const { output, workingDirectory } = context;
	const entryPath = path.join(workingDirectory, ENTRY_FILE_NAME);
	if (await pathExists(entryPath)) {
		output.error(`Standards init could not run.

Problem:
  '.standards.yml' already exists in ${workingDirectory}.

Next action:
  Edit the existing file, or run 'standards init' in a different directory.`);
		return 1;
	}

	let rule: Rule | undefined;
	if (context.interactive) {
		const choice = await select({
			message: "How do you want to start your Standards config?",
			choices: [
				{
					name: "Add my first rule",
					value: "rule",
					description: "Write one rule, and create a config around it.",
				},
				{
					name: "Start from examples",
					value: "examples",
					description: "Create a config with commented examples only.",
				},
				{ name: "Cancel", value: "cancel" },
			],
		});
		if (choice === "cancel") {
			output.log(
				`${figures.cross} Standards init cancelled. No file was created.`,
			);
			return 0;
		}
		if (choice === "rule") {
			rule = await promptForRule();
		}
	}

	const configuration: Configuration = {
		version: 1,
		extends: [],
		rules: rule === undefined ? [] : [rule],
	};
	// The wizard does not validate every field (for example the glob), so the
	// whole configuration is checked once before it reaches the disk.
	const result = configurationSchema.safeParse(configuration);
	if (!result.success) {
		output.error(`Standards init could not write a valid configuration.

Problem:
  The rule values did not produce a valid ${ENTRY_FILE_NAME}: ${result.error.issues[0]?.message}.

Next action:
  Run 'standards init' again and give valid rule values.`);
		return 1;
	}

	await writeFile(entryPath, `${CONFIG_HEADER}${stringify(configuration)}`);
	output.log(
		rule === undefined
			? `${figures.tick} Created ${ENTRY_FILE_NAME} in ${workingDirectory}.`
			: `${figures.tick} Created ${ENTRY_FILE_NAME} in ${workingDirectory} with rule '${rule.id}'.`,
	);
	return 0;
}

/** Collect the fields of one rule through interactive prompts. */
async function promptForRule(): Promise<Rule> {
	const id = await input({
		message: "Rule id (lowercase letters, digits, '.', '_' and '-'):",
		default: "my-org.first-rule",
		validate: (value) =>
			RULE_ID_PATTERN.test(value.trim())
				? true
				: "Use a stable lowercase rule id (for example: my-org.first-rule).",
	});
	const level = await select({
		message: "Requirement level:",
		choices: requirementLevels.map((value) => ({ name: value, value })),
	});
	const description = await input({
		message: "Rule description:",
		validate: (value) =>
			value.trim().length > 0 ? true : "A description is required.",
	});
	const rationale = await input({
		message: "Rule rationale (why this rule exists):",
	});
	const include = await input({
		message: "Files this rule applies to (glob):",
		default: "**/*",
	});
	return {
		id: id.trim(),
		level,
		description: description.trim(),
		rationale: rationale.trim(),
		applies_to: { include: [include.trim()] },
	};
}
