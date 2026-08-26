import { readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
	GitSourceStore,
	PopulateGitCheckout,
} from "../cache/git-source-cache.js";
import { createTemporaryGitSourceStore } from "../cache/git-source-cache.js";
import type { ImportProgressReporter } from "../cache/import-progress.js";
import { loadConfiguration } from "../config/configuration-loader.js";
import type {
	FolderRule,
	GitKnowledgeSource,
	KnowledgeSource,
} from "../config/configuration-schema.js";
import { RULE_ID_PATTERN } from "../config/configuration-schema.js";
import { errorMessage } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import type { Rule } from "./rule.js";
import type { RuleFrontmatter } from "./rule-document.js";
import { parseRuleDocument } from "./rule-document.js";

const ENTRY_FILE_NAME = ".standards.yml";

/** An error found while resolving the knowledge sources of a configuration. */
export class ConfigurationResolutionError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "ConfigurationResolutionError";
	}
}

/** The resolved commit of one Git knowledge source, for traceability. */
export interface ResolvedGitSource {
	repository: string;
	ref: string;
	commit: string;
}

/** One warning for a knowledge document the loader skipped. */
export interface RuleWarning {
	document: string;
	problem: string;
}

/** The rules, resolved Git commits, and warnings of one load. */
export interface RuleLoadResult {
	rules: Rule[];
	gitSources: ResolvedGitSource[];
	warnings: RuleWarning[];
}

/** Optional cache and progress inputs for rule loading. */
export interface LoadRulesOptions {
	gitSourceStore?: GitSourceStore;
	reportProgress?: ImportProgressReporter;
}

/** Return true when a path is inside a root directory. */
function isWithinRoot(rootDirectory: string, candidatePath: string): boolean {
	const relativePath = path.relative(rootDirectory, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith(`..${path.sep}`) &&
			relativePath !== ".." &&
			!path.isAbsolute(relativePath))
	);
}

/** Resolve a repository root to its canonical absolute path. */
export async function canonicalizeRepositoryRoot(
	repositoryRoot: string,
): Promise<string> {
	try {
		return await realpath(repositoryRoot);
	} catch (error) {
		throw new ConfigurationResolutionError(
			`Cannot access repository root '${repositoryRoot}': ${errorMessage(error)}`,
		);
	}
}

/**
 * Populate a destination directory with a verified checkout of one commit,
 * without the `.git` directory. It throws when the checked-out content does not
 * match the requested commit object ID, so unverified content never reaches the
 * cache.
 */
function fetchGitCheckout(
	repository: string,
	commit: string,
): PopulateGitCheckout {
	return async (destinationDirectory) => {
		try {
			await runGit(
				["clone", "--no-checkout", "--quiet", repository, "."],
				destinationDirectory,
			);

			let verifiedCommit: string;
			try {
				verifiedCommit = await runGit(
					["rev-parse", "--verify", `${commit}^{commit}`],
					destinationDirectory,
				);
			} catch {
				await runGit(
					["fetch", "--no-tags", "--quiet", "origin", commit],
					destinationDirectory,
				);
				verifiedCommit = await runGit(
					["rev-parse", "--verify", `${commit}^{commit}`],
					destinationDirectory,
				);
			}

			if (verifiedCommit.toLowerCase() !== commit) {
				throw new Error(
					`Object '${commit}' resolves to different commit '${verifiedCommit}'.`,
				);
			}

			await runGit(
				["checkout", "--detach", "--quiet", commit],
				destinationDirectory,
			);
			const checkedOutCommit = await runGit(
				["rev-parse", "HEAD"],
				destinationDirectory,
			);
			if (checkedOutCommit.toLowerCase() !== commit) {
				throw new Error(
					`Checked out commit '${checkedOutCommit}' instead of '${commit}'.`,
				);
			}

			await rm(path.join(destinationDirectory, ".git"), {
				recursive: true,
				force: true,
			});
		} catch (error) {
			throw new ConfigurationResolutionError(
				`Cannot fetch Git repository '${repository}' at commit '${commit}': ${errorMessage(error)}`,
			);
		}
	};
}

/**
 * Resolve a branch to its current commit with `git ls-remote`
 * (specs/configuration.md freshness). Without a `ref`, it resolves the
 * repository's default branch through the symbolic `HEAD` reference.
 */
async function resolveBranchCommit(
	repository: string,
	ref: string | undefined,
	workingDirectory: string,
): Promise<{ ref: string; commit: string }> {
	let output: string;
	const listArguments =
		ref === undefined
			? ["ls-remote", "--symref", repository, "HEAD"]
			: ["ls-remote", repository, `refs/heads/${ref}`];
	try {
		output = await runGit(listArguments, workingDirectory);
	} catch (error) {
		throw new ConfigurationResolutionError(
			`Cannot reach Git repository '${repository}': ${errorMessage(error)}`,
		);
	}

	const lines = output.split("\n").filter((line) => line !== "");
	if (ref !== undefined) {
		const commit = lines
			.map((line) => line.split("\t"))
			.find(([, name]) => name === `refs/heads/${ref}`)?.[0];
		if (commit === undefined) {
			throw new ConfigurationResolutionError(
				`Branch '${ref}' does not exist in '${repository}'.`,
			);
		}
		return { ref, commit: commit.toLowerCase() };
	}

	const symrefMatch = lines
		.map((line) => /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line))
		.find((match) => match !== null);
	const headCommit = lines
		.map((line) => line.split("\t"))
		.find(
			([objectId, name]) =>
				name === "HEAD" &&
				objectId !== undefined &&
				/^[0-9a-fA-F]{40,64}$/.test(objectId),
		)?.[0];
	if (headCommit === undefined) {
		throw new ConfigurationResolutionError(
			`Cannot resolve the default branch of '${repository}'.`,
		);
	}
	return {
		ref: symrefMatch?.[1] ?? "HEAD",
		commit: headCommit.toLowerCase(),
	};
}

/** One knowledge document discovered under a mapped folder. */
interface DiscoveredDocument {
	absolutePath: string;
	/** The document path relative to the bundle root, with `/` separators. */
	bundlePath: string;
	/** The document path relative to its mapped folder, with `/` separators. */
	folderPath: string;
	level: FolderRule["level"];
}

/** A discovered document whose frontmatter parsed and id derived. */
interface ParsedDocument extends DiscoveredDocument {
	id: string;
	frontmatter: RuleFrontmatter;
	body: string;
}

/** Recursively collect the markdown documents under a directory, sorted. */
async function walkMarkdownFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkMarkdownFiles(entryPath)));
			continue;
		}
		// index.md files are navigation, not rules (specs/configuration.md).
		if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			entry.name !== "index.md"
		) {
			files.push(entryPath);
		}
	}
	return files;
}

/** Format a path relative to a root with portable `/` separators. */
function portableRelativePath(rootDirectory: string, filePath: string): string {
	return path.relative(rootDirectory, filePath).split(path.sep).join("/");
}

/** Derive a rule id from a document path relative to its mapped folder. */
function deriveRuleId(folderPath: string): string {
	return folderPath.slice(0, -".md".length).replaceAll("/", ".");
}

/** The bundle root directory and naming context of one resolved source. */
interface ResolvedBundle {
	root: string;
	/** The readable source name used by duplicate-identity errors. */
	label: string;
	/** Return the readable name of one document for warnings. */
	documentLabel: (bundlePath: string) => string;
}

/**
 * Load the rules of one resolved bundle: discover the documents under each
 * mapped folder, parse them, resolve `superseded_by` chains, and append the
 * enforced rules. Invalid documents append warnings instead
 * (specs/configuration.md).
 */
async function loadBundleRules(
	bundle: ResolvedBundle,
	folderRules: readonly FolderRule[],
	rules: Rule[],
	ruleSources: Map<string, string>,
	warnings: RuleWarning[],
): Promise<void> {
	const discovered: DiscoveredDocument[] = [];
	for (const mapping of folderRules) {
		const folderDirectory = path.join(
			bundle.root,
			...mapping.folder.split("/"),
		);
		let folderIsDirectory = false;
		try {
			folderIsDirectory = (await stat(folderDirectory)).isDirectory();
		} catch {
			folderIsDirectory = false;
		}
		if (!folderIsDirectory) {
			throw new ConfigurationResolutionError(
				`Folder '${mapping.folder}' does not exist in knowledge source '${bundle.label}'.`,
			);
		}

		for (const absolutePath of await walkMarkdownFiles(folderDirectory)) {
			discovered.push({
				absolutePath,
				bundlePath: portableRelativePath(bundle.root, absolutePath),
				folderPath: portableRelativePath(folderDirectory, absolutePath),
				level: mapping.level,
			});
		}
	}

	const parsedByBundlePath = new Map<string, ParsedDocument>();
	const ordered: ParsedDocument[] = [];
	for (const document of discovered) {
		const documentName = bundle.documentLabel(document.bundlePath);
		let sourceText: string;
		try {
			sourceText = await readFile(document.absolutePath, "utf8");
		} catch (error) {
			warnings.push({
				document: documentName,
				problem: `Cannot read the document: ${errorMessage(error)}`,
			});
			continue;
		}

		const parsed = parseRuleDocument(sourceText);
		if (!parsed.ok) {
			warnings.push({ document: documentName, problem: parsed.problem });
			continue;
		}

		const id = deriveRuleId(document.folderPath);
		if (!RULE_ID_PATTERN.test(id)) {
			warnings.push({
				document: documentName,
				problem: `Derived id '${id}' does not match the rule id grammar.`,
			});
			continue;
		}

		const parsedDocument: ParsedDocument = {
			...document,
			id,
			frontmatter: parsed.frontmatter,
			body: parsed.body,
		};
		parsedByBundlePath.set(document.bundlePath, parsedDocument);
		ordered.push(parsedDocument);
	}

	// A superseded document aliases the newest document of its chain
	// (specs/configuration.md rule identity).
	const aliasesByBundlePath = new Map<string, string[]>();
	for (const document of ordered) {
		if (document.frontmatter.superseded_by === undefined) {
			continue;
		}
		const documentName = bundle.documentLabel(document.bundlePath);
		const visited = new Set<string>([document.bundlePath]);
		let current = document;
		let problem: string | undefined;
		while (current.frontmatter.superseded_by !== undefined) {
			const targetPath = path.posix.normalize(
				path.posix.join(
					path.posix.dirname(current.bundlePath),
					current.frontmatter.superseded_by,
				),
			);
			const target = parsedByBundlePath.get(targetPath);
			if (target === undefined) {
				problem = `superseded_by points to '${targetPath}', which is not a mapped knowledge document.`;
				break;
			}
			if (visited.has(targetPath)) {
				problem = "The superseded_by chain forms a cycle.";
				break;
			}
			visited.add(targetPath);
			current = target;
		}
		if (problem !== undefined) {
			warnings.push({ document: documentName, problem });
			continue;
		}
		const aliases = aliasesByBundlePath.get(current.bundlePath) ?? [];
		aliases.push(document.id);
		aliasesByBundlePath.set(current.bundlePath, aliases);
	}

	for (const document of ordered) {
		const enforced =
			document.frontmatter.superseded_by === undefined &&
			document.frontmatter.status === "stable" &&
			(document.frontmatter.adr_status === undefined ||
				document.frontmatter.adr_status === "accepted");
		if (!enforced) {
			continue;
		}

		const previousSource = ruleSources.get(document.id);
		if (previousSource !== undefined) {
			throw new ConfigurationResolutionError(
				`Rule ID '${document.id}' in '${bundle.label}' duplicates the rule from '${previousSource}'.`,
			);
		}
		ruleSources.set(document.id, bundle.label);

		const aliases = [
			...new Set(aliasesByBundlePath.get(document.bundlePath) ?? []),
		].sort();
		rules.push({
			id: document.id,
			level: document.level,
			title:
				document.frontmatter.title ??
				path.posix.basename(document.folderPath, ".md"),
			description: document.frontmatter.description,
			body: document.body,
			applies_to: document.frontmatter.applies_to,
			type: document.frontmatter.type,
			tags: document.frontmatter.tags,
			aliases,
		});
	}
}

/**
 * Load the rules that the configuration's knowledge sources declare
 * (specs/configuration.md resolution).
 *
 * Sources follow their branch: each Git `ref` resolves to its current commit
 * at the start of the run, and the resolved commits are returned for the
 * report. A bad document is skipped with a warning and never fails the run; a
 * configuration mistake — a missing folder, an unreachable source, a
 * duplicate identity — fails the run.
 */
export async function loadRules(
	repositoryRoot: string,
	options: LoadRulesOptions = {},
): Promise<RuleLoadResult> {
	const canonicalRepositoryRoot =
		await canonicalizeRepositoryRoot(repositoryRoot);

	const entryPath = path.join(canonicalRepositoryRoot, ENTRY_FILE_NAME);
	let entryText: string;
	try {
		entryText = await readFile(entryPath, "utf8");
	} catch (error) {
		throw new ConfigurationResolutionError(
			`Cannot read configuration '${ENTRY_FILE_NAME}': ${errorMessage(error)}`,
		);
	}
	const configuration = loadConfiguration(entryText);

	const ownsGitSourceStore = options.gitSourceStore === undefined;
	const gitSourceStore =
		options.gitSourceStore ?? createTemporaryGitSourceStore();

	const rules: Rule[] = [];
	const ruleSources = new Map<string, string>();
	const warnings: RuleWarning[] = [];
	const gitSources: ResolvedGitSource[] = [];
	const resolvedBranches = new Map<
		string,
		Promise<{ ref: string; commit: string }>
	>();
	const checkouts = new Map<string, Promise<string>>();

	function resolveBranch(
		source: GitKnowledgeSource["git"],
	): Promise<{ ref: string; commit: string }> {
		const key = `${source.repository} ${source.ref ?? ""}`;
		let resolved = resolvedBranches.get(key);
		if (resolved === undefined) {
			resolved = resolveBranchCommit(
				source.repository,
				source.ref,
				canonicalRepositoryRoot,
			);
			resolvedBranches.set(key, resolved);
		}
		return resolved;
	}

	function provideCheckout(
		repository: string,
		commit: string,
	): Promise<string> {
		const key = `${repository} ${commit}`;
		let checkout = checkouts.get(key);
		if (checkout === undefined) {
			checkout = gitSourceStore
				.provideGitCheckout(commit, fetchGitCheckout(repository, commit))
				.then(async (result) => {
					if (result.cacheHit) {
						options.reportProgress?.reportCacheHit(repository, commit);
					} else {
						options.reportProgress?.reportFetch(repository, commit);
					}
					return realpath(result.contentDirectory);
				});
			checkouts.set(key, checkout);
		}
		return checkout;
	}

	async function resolveBundle(
		source: KnowledgeSource,
	): Promise<ResolvedBundle> {
		if ("git" in source) {
			options.reportProgress?.reportResolvingRevision(
				source.git.repository,
				source.git.ref ?? "HEAD",
			);
			const { ref, commit } = await resolveBranch(source.git);
			if (
				!gitSources.some(
					(resolved) =>
						resolved.repository === source.git.repository &&
						resolved.ref === ref,
				)
			) {
				gitSources.push({ repository: source.git.repository, ref, commit });
			}
			const checkoutRoot = await provideCheckout(source.git.repository, commit);
			let bundleRoot = checkoutRoot;
			if (source.git.path !== undefined) {
				const candidate = path.resolve(checkoutRoot, source.git.path);
				if (!isWithinRoot(checkoutRoot, candidate)) {
					throw new ConfigurationResolutionError(
						`Knowledge source path '${source.git.path}' escapes the repository '${source.git.repository}'.`,
					);
				}
				try {
					bundleRoot = await realpath(candidate);
				} catch (error) {
					throw new ConfigurationResolutionError(
						`Cannot access path '${source.git.path}' in '${source.git.repository}': ${errorMessage(error)}`,
					);
				}
				if (!isWithinRoot(checkoutRoot, bundleRoot)) {
					throw new ConfigurationResolutionError(
						`Knowledge source path '${source.git.path}' resolves outside the repository '${source.git.repository}'.`,
					);
				}
			}
			const label = `${source.git.repository}@${ref}`;
			return {
				root: bundleRoot,
				label,
				documentLabel: (bundlePath) => `${label}:${bundlePath}`,
			};
		}

		const candidate = path.resolve(canonicalRepositoryRoot, source.path);
		if (!isWithinRoot(canonicalRepositoryRoot, candidate)) {
			throw new ConfigurationResolutionError(
				`Knowledge source path '${source.path}' escapes repository root '${canonicalRepositoryRoot}'.`,
			);
		}
		let bundleRoot: string;
		try {
			bundleRoot = await realpath(candidate);
		} catch (error) {
			throw new ConfigurationResolutionError(
				`Cannot access knowledge source '${source.path}': ${errorMessage(error)}`,
			);
		}
		if (!isWithinRoot(canonicalRepositoryRoot, bundleRoot)) {
			throw new ConfigurationResolutionError(
				`Knowledge source path '${source.path}' resolves outside repository root '${canonicalRepositoryRoot}'.`,
			);
		}
		const label = portableRelativePath(canonicalRepositoryRoot, bundleRoot);
		return {
			root: bundleRoot,
			label,
			documentLabel: (bundlePath) => `${label}/${bundlePath}`,
		};
	}

	try {
		for (const source of configuration.sources) {
			const bundle = await resolveBundle(source);
			await loadBundleRules(bundle, source.rules, rules, ruleSources, warnings);
		}
		return { rules, gitSources, warnings };
	} finally {
		if (ownsGitSourceStore) {
			await gitSourceStore.dispose();
		}
	}
}
