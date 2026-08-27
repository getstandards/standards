import type { Dirent } from "node:fs";
import { access, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import figures from "figures";
import { stringify } from "yaml";
import { configurationSchema } from "../../config/configuration-schema.js";
import { errorMessage } from "../../utils/errors.js";
import type { CommandContext } from "../cli-context.js";

const ENTRY_FILE_NAME = ".standards.yml";

/** The location a user gives for one knowledge source. */
export type SourceLocation =
	| { kind: "local"; path: string }
	| { kind: "git"; repository: string; branch?: string; path?: string };

/** One folder that a scan found to contain knowledge documents. */
export interface ScannedFolder {
	/** The folder path relative to the bundle root, with `/` separators. */
	folder: string;
	/** The number of markdown documents under the folder. */
	documentCount: number;
}

/** The result of scanning one source for folders that hold documents. */
export interface ScanResult {
	folders: ScannedFolder[];
	/** False when the source could not be scanned and needs manual entry. */
	scanned: boolean;
}

/** Scan a source for the folders that contain knowledge documents. */
export type ScanSource = (
	location: SourceLocation,
	workingDirectory: string,
) => Promise<ScanResult>;

/** One requirement level of a folder mapping. */
type Level = "MUST" | "SHOULD";

/** The written form of one folder mapping: a bare level or an expanded object. */
type FolderMappingValue =
	| Level
	| {
			level: Level;
			documents?: { exclude: string[] };
			applies_to?: { include?: string[]; exclude?: string[] };
	  };

/** The written form of one knowledge source. */
interface WrittenSource {
	path?: string;
	repository?: string;
	branch?: string;
	id_prefix?: string;
	folders: Record<string, FolderMappingValue>;
}

/** Return true when a candidate path is accessible. */
async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

/** Split a comma or newline separated list into trimmed, non-empty entries. */
function splitList(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** Recursively count the markdown documents that a scan found per folder. */
async function scanBundleFolders(bundleRoot: string): Promise<ScannedFolder[]> {
	const counts = new Map<string, number>();
	async function walk(directory: string): Promise<number> {
		let entries: Dirent[];
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return 0;
		}
		let count = 0;
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				const nested = await walk(entryPath);
				if (nested > 0) {
					const relative = path
						.relative(bundleRoot, entryPath)
						.split(path.sep)
						.join("/");
					counts.set(relative, nested);
				}
				count += nested;
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				count += 1;
			}
		}
		return count;
	}
	await walk(bundleRoot);
	return [...counts.entries()]
		.map(([folder, documentCount]) => ({ folder, documentCount }))
		.sort((a, b) => a.folder.localeCompare(b.folder));
}

/**
 * Scan a local source, or report that a Git source needs manual folder entry.
 *
 * A Git source is not fetched here: the dialogue lets the user enter folder
 * paths manually when a source cannot be scanned (specs/init interactive).
 */
const scanSourceFolders: ScanSource = async (location, workingDirectory) => {
	if (location.kind === "git") {
		return { folders: [], scanned: false };
	}
	const bundleRoot = path.resolve(workingDirectory, location.path);
	if (!(await pathExists(bundleRoot))) {
		return { folders: [], scanned: false };
	}
	return { folders: await scanBundleFolders(bundleRoot), scanned: true };
};

/** Remove any selected folder that sits inside another selected folder. */
function withoutNestedFolders(folders: readonly string[]): string[] {
	return folders.filter(
		(folder) =>
			!folders.some(
				(other) => other !== folder && folder.startsWith(`${other}/`),
			),
	);
}

/** Ask the user for the location of one knowledge source. */
async function promptSourceLocation(): Promise<SourceLocation> {
	const kind = await select<"local" | "git">({
		message: "Where is the knowledge source?",
		choices: [
			{ name: "A local directory in this repository", value: "local" },
			{ name: "A Git repository", value: "git" },
		],
	});
	if (kind === "local") {
		const bundlePath = await input({
			message: "Path to the bundle root (relative to the repository root):",
			default: "knowledge",
		});
		return { kind: "local", path: bundlePath.trim() };
	}
	const repository = (await input({ message: "Git repository URL:" })).trim();
	const branch = (
		await input({ message: "Branch (leave empty for the default branch):" })
	).trim();
	const bundlePath = (
		await input({
			message: "Bundle path inside the repository (leave empty for the root):",
		})
	).trim();
	return {
		kind: "git",
		repository,
		branch: branch === "" ? undefined : branch,
		path: bundlePath === "" ? undefined : bundlePath,
	};
}

/** Ask the user which folders of a scanned source hold rules. */
async function promptFolders(scan: ScanResult): Promise<string[]> {
	if (scan.scanned && scan.folders.length > 0) {
		const selected = await checkbox<string>({
			message: "Select the folders that hold rules:",
			choices: scan.folders.map((folder) => ({
				name: `${folder.folder} (${folder.documentCount} document${
					folder.documentCount === 1 ? "" : "s"
				})`,
				value: folder.folder,
			})),
		});
		if (selected.length > 0) {
			return withoutNestedFolders(selected);
		}
	}
	const manual = await input({
		message: "Enter folder paths that hold rules, separated by commas:",
	});
	return withoutNestedFolders(splitList(manual));
}

/** Ask the user to configure one selected folder mapping. */
async function promptFolderMapping(
	folder: string,
): Promise<FolderMappingValue> {
	const level = await select<Level>({
		message: `Requirement level for '${folder}':`,
		choices: [
			{ name: "MUST (blocking)", value: "MUST" },
			{ name: "SHOULD (advisory)", value: "SHOULD" },
		],
	});

	const excludeDocuments = (await confirm({
		message: `Does '${folder}' contain documents that must not become rules?`,
		default: false,
	}))
		? splitList(
				await input({
					message: "Document exclude globs (relative to the folder):",
				}),
			)
		: [];

	const scopeFiles = await confirm({
		message: `Limit '${folder}' to some target repository files?`,
		default: false,
	});
	const appliesToInclude = scopeFiles
		? splitList(await input({ message: "applies_to include globs:" }))
		: [];
	const appliesToExclude = scopeFiles
		? splitList(await input({ message: "applies_to exclude globs:" }))
		: [];

	if (
		excludeDocuments.length === 0 &&
		appliesToInclude.length === 0 &&
		appliesToExclude.length === 0
	) {
		return level;
	}
	const mapping: Exclude<FolderMappingValue, Level> = { level };
	if (excludeDocuments.length > 0) {
		mapping.documents = { exclude: excludeDocuments };
	}
	if (appliesToInclude.length > 0 || appliesToExclude.length > 0) {
		mapping.applies_to = {};
		if (appliesToInclude.length > 0) {
			mapping.applies_to.include = appliesToInclude;
		}
		if (appliesToExclude.length > 0) {
			mapping.applies_to.exclude = appliesToExclude;
		}
	}
	return mapping;
}

/** Run the dialogue for one knowledge source. */
async function promptSource(
	scanSource: ScanSource,
	workingDirectory: string,
): Promise<WrittenSource | undefined> {
	const location = await promptSourceLocation();
	// A source the dialogue cannot scan is not an error: promptFolders lets the
	// user enter the folder paths manually (specs/init interactive).
	const scan = await scanSource(location, workingDirectory);
	const folders = await promptFolders(scan);
	if (folders.length === 0) {
		return undefined;
	}

	const mappings: Record<string, FolderMappingValue> = {};
	for (const folder of folders) {
		mappings[folder] = await promptFolderMapping(folder);
	}

	const idPrefix = (
		await input({
			message: "Optional id prefix for this source (leave empty for none):",
		})
	).trim();

	const source: WrittenSource = { folders: mappings };
	if (location.kind === "local") {
		source.path = location.path;
	} else {
		source.repository = location.repository;
		if (location.branch !== undefined) {
			source.branch = location.branch;
		}
		if (location.path !== undefined) {
			source.path = location.path;
		}
	}
	if (idPrefix !== "") {
		source.id_prefix = idPrefix;
	}
	return source;
}

/** Serialize the collected sources to the `.standards.yml` document text. */
function renderConfiguration(sources: WrittenSource[]): string {
	const header = `# Standards configuration for this repository.
#
# A source is a directory or a Git repository that holds knowledge documents
# in the Open Knowledge Format. Each folder maps to a requirement level:
# MUST is blocking, SHOULD is advisory.
`;
	const document = stringify({ version: 2, sources });
	return `${header}${document}`;
}

/**
 * Create the entry file through an interactive dialogue (specs/cli.md init).
 *
 * The dialogue asks for one or more knowledge sources, scans a local source
 * for the folders that hold documents, and asks for each folder's level and
 * optional filters. It shows a preview and asks for confirmation before it
 * writes the file. Without a terminal, it refuses and leaves the repository
 * unchanged. It never replaces an existing entry file.
 */
export async function runInitCommand(
	context: CommandContext,
	scanSource: ScanSource = scanSourceFolders,
): Promise<number> {
	const { output, workingDirectory, interactive } = context;
	const entryPath = path.join(workingDirectory, ENTRY_FILE_NAME);

	if (await pathExists(entryPath)) {
		output.error(`Standards init could not run.

Problem:
  '.standards.yml' already exists in ${workingDirectory}.

Next action:
  Edit the existing file, or run 'standards init' in a different directory.`);
		return 1;
	}

	if (!interactive) {
		output.error(`Standards init needs interactive input.

Problem:
  Standard input and output are not a terminal, so the dialogue cannot run.

Next action:
  Run 'standards init' in a terminal.`);
		return 1;
	}

	const sources: WrittenSource[] = [];
	for (;;) {
		const source = await promptSource(scanSource, workingDirectory);
		if (source !== undefined) {
			sources.push(source);
		}
		const addAnother = await confirm({
			message: "Add another knowledge source?",
			default: false,
		});
		if (!addAnother) {
			break;
		}
	}

	const content = renderConfiguration(sources);
	const validation = configurationSchema.safeParse({ version: 2, sources });
	if (!validation.success) {
		output.error(`Standards init could not build a valid configuration.

Problem:
  ${validation.error.issues[0]?.message ?? "The configuration is invalid."}

Next action:
  Run 'standards init' again and adjust the folder selections.`);
		return 1;
	}

	output.log(`\nConfiguration preview:\n\n${content}`);
	const write = await confirm({
		message: `Write this to ${ENTRY_FILE_NAME}?`,
		default: true,
	});
	if (!write) {
		output.log("No changes made.");
		return 0;
	}

	try {
		await writeFile(entryPath, content);
	} catch (error) {
		output.error(`Standards init could not write the configuration.

Problem:
  ${errorMessage(error)}

Next action:
  Check the directory permissions, then run 'standards init' again.`);
		return 1;
	}

	output.log(
		`${figures.tick} Created ${ENTRY_FILE_NAME} in ${workingDirectory}. Run 'standards validate' to confirm it.`,
	);
	return 0;
}
