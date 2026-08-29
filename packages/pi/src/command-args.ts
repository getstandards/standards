/**
 * The `/standards` arguments, named as `standards review` names them
 * (specs/cli.md review). The extension invents no scope of its own.
 */
export interface StandardsCommandArgs {
	/** Repository-relative file or directory paths that limit the review. */
	targets: string[];
	base?: string;
	/** A `<base>..<head>` or `<base>...<head>` Git commit range. */
	range?: string;
	staged: boolean;
	all: boolean;
	rule?: string;
	folder?: string;
	model?: string;
	evaluationModel?: string;
	verificationModel?: string;
}

/** A `/standards` argument the extension cannot use. */
export class StandardsArgumentError extends Error {
	public constructor(public readonly diagnostic: string) {
		super(diagnostic);
		this.name = "StandardsArgumentError";
	}
}

/** The options that take a value, mapped to their field. */
const VALUE_OPTIONS = {
	"--base": "base",
	"--range": "range",
	"--rule": "rule",
	"--folder": "folder",
	"--model": "model",
	"--evaluation-model": "evaluationModel",
	"--verification-model": "verificationModel",
} as const;

/** The options that take no value, mapped to their field. */
const FLAG_OPTIONS = {
	"--staged": "staged",
	"--all": "all",
} as const;

/**
 * Parse the raw `/standards` argument string (pi passes one string).
 *
 * Without an argument the review runs the default change scope, `working-tree`.
 * `--rule` and `--folder` are mutually exclusive, as they are on the command
 * line; the core rule filter enforces that a value names something.
 */
export function parseStandardsArgs(args: string): StandardsCommandArgs {
	const parsed: StandardsCommandArgs = {
		targets: [],
		staged: false,
		all: false,
	};
	const words = args.split(/\s+/).filter((word) => word !== "");

	for (let index = 0; index < words.length; index += 1) {
		const word = words[index] as string;
		if (!word.startsWith("-")) {
			parsed.targets.push(word);
			continue;
		}

		const equalsIndex = word.indexOf("=");
		const name = equalsIndex === -1 ? word : word.slice(0, equalsIndex);
		const inlineValue =
			equalsIndex === -1 ? undefined : word.slice(equalsIndex + 1);

		const flagField = FLAG_OPTIONS[name as keyof typeof FLAG_OPTIONS];
		if (flagField !== undefined) {
			if (inlineValue !== undefined) {
				throw new StandardsArgumentError(
					`Option '${name}' takes no value.\n\nNext action:\n  Run '/standards ${name}' without a value.`,
				);
			}
			parsed[flagField] = true;
			continue;
		}

		const valueField = VALUE_OPTIONS[name as keyof typeof VALUE_OPTIONS];
		if (valueField === undefined) {
			throw new StandardsArgumentError(
				`Unknown option '${name}'.\n\nNext action:\n  Run '/standards' with ${Object.keys(
					{ ...FLAG_OPTIONS, ...VALUE_OPTIONS },
				).join(", ")}, or with target paths.`,
			);
		}

		let value = inlineValue;
		if (value === undefined) {
			index += 1;
			value = words[index];
		}
		if (value === undefined || value === "") {
			throw new StandardsArgumentError(
				`Option '${name}' expects a value.\n\nNext action:\n  Run '/standards ${name} <value>'.`,
			);
		}
		parsed[valueField] = value;
	}

	if (parsed.rule !== undefined && parsed.folder !== undefined) {
		throw new StandardsArgumentError(
			"Options '--rule' and '--folder' cannot be used together.\n\nNext action:\n  Give one of them, or neither.",
		);
	}

	return parsed;
}
