import { readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import type {
	GitSourceStore,
	PopulateGitCheckout,
} from "../cache/git-source-cache.js";
import { createTemporaryGitSourceStore } from "../cache/git-source-cache.js";
import type { ImportProgressReporter } from "../cache/import-progress.js";
import { loadConfiguration } from "../config/configuration-loader.js";
import type {
	AppliesTo,
	AppliesToEntry,
	DocumentFilter,
	FolderMapping,
	GitKnowledgeSource,
	KnowledgeSource,
} from "../config/configuration-schema.js";
import { RULE_ID_PATTERN } from "../config/configuration-schema.js";
import { errorMessage } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import type { Rule } from "./rule.js";
import type { RuleFrontmatter } from "./rule-document.js";
import { parseRuleDocument } from "./rule-document.js";

/** The entry file names, in discovery order (specs/configuration.md). */
export const ENTRY_FILE_NAMES = [".standards.yml", ".standards.yaml"] as const;

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
	branch: string;
	commit: string;
}

/** One warning for a knowledge document the loader skipped. */
export interface RuleWarning {
	document: string;
	problem: string;
}

/**
 * The complete output of configuration loading and rule discovery: the ordered
 * rules, the resolved Git commits, and the warnings (specs/configuration.md).
 */
export interface Resolution {
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
 * (specs/configuration.md freshness). Without a `branch`, it resolves the
 * repository's default branch through the symbolic `HEAD` reference.
 */
async function resolveBranchCommit(
	repository: string,
	branch: string | undefined,
	workingDirectory: string,
): Promise<{ branch: string; commit: string }> {
	let output: string;
	const listArguments =
		branch === undefined
			? ["ls-remote", "--symref", repository, "HEAD"]
			: ["ls-remote", repository, `refs/heads/${branch}`];
	try {
		output = await runGit(listArguments, workingDirectory);
	} catch (error) {
		throw new ConfigurationResolutionError(
			`Cannot reach Git repository '${repository}': ${errorMessage(error)}`,
		);
	}

	const lines = output.split("\n").filter((line) => line !== "");
	if (branch !== undefined) {
		const commit = lines
			.map((line) => line.split("\t"))
			.find(([, name]) => name === `refs/heads/${branch}`)?.[0];
		if (commit === undefined) {
			throw new ConfigurationResolutionError(
				`Branch '${branch}' does not exist in '${repository}'.`,
			);
		}
		return { branch, commit: commit.toLowerCase() };
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
		branch: symrefMatch?.[1] ?? "HEAD",
		commit: headCommit.toLowerCase(),
	};
}

/** The discovered entry file of a repository. */
export interface EntryFile {
	name: string;
	path: string;
}

/**
 * Find the entry file at the repository root: `.standards.yml` or
 * `.standards.yaml`. Two entry files are a configuration error. When none
 * exists, it returns the `.standards.yml` candidate, so the caller's read
 * fails with a clear message (specs/configuration.md).
 */
export async function findEntryFile(
	repositoryRoot: string,
): Promise<EntryFile> {
	const present: EntryFile[] = [];
	for (const name of ENTRY_FILE_NAMES) {
		const candidate = { name, path: path.join(repositoryRoot, name) };
		try {
			if ((await stat(candidate.path)).isFile()) {
				present.push(candidate);
			}
		} catch {
			// A missing candidate is not an error.
		}
	}
	if (present.length > 1) {
		throw new ConfigurationResolutionError(
			"Both '.standards.yml' and '.standards.yaml' exist at the repository root. Keep one entry file.",
		);
	}
	return (
		present[0] ?? {
			name: ENTRY_FILE_NAMES[0],
			path: path.join(repositoryRoot, ENTRY_FILE_NAMES[0]),
		}
	);
}

/** One knowledge document discovered under a mapped folder. */
interface DiscoveredDocument {
	absolutePath: string;
	/** The document path relative to the bundle root, with `/` separators. */
	bundlePath: string;
	/** The document path relative to its mapped folder, with `/` separators. */
	folderPath: string;
	mapping: FolderMapping;
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
		if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

/** Format a path relative to a root with portable `/` separators. */
function portableRelativePath(rootDirectory: string, filePath: string): string {
	return path.relative(rootDirectory, filePath).split(path.sep).join("/");
}

/** Match repository or document paths with `/` separators and dot files. */
const GLOB_MATCH_OPTIONS: picomatch.PicomatchOptions = { dot: true };

/**
 * Build a predicate that keeps a folder-relative document path when it matches
 * the `documents` filter. The default `include` glob is `**` + `/*.md`, and the
 * default `exclude` list is empty; exclusion wins (specs/configuration.md).
 */
function compileDocumentFilter(
	filter: DocumentFilter | undefined,
): (folderPath: string) => boolean {
	const isIncluded = picomatch(
		filter?.include ?? ["**/*.md"],
		GLOB_MATCH_OPTIONS,
	);
	const exclude = filter?.exclude ?? [];
	const isExcluded =
		exclude.length === 0 ? () => false : picomatch(exclude, GLOB_MATCH_OPTIONS);
	return (folderPath) => isIncluded(folderPath) && !isExcluded(folderPath);
}

/**
 * Select the `applies_to` filter of one document: the first entry whose
 * `documents` globs match the folder-relative path decides the filter. A
 * document that no entry matches gets no filter
 * (specs/configuration.md target repository applicability).
 */
function selectAppliesTo(
	entries: readonly AppliesToEntry[] | undefined,
	folderPath: string,
): AppliesTo | undefined {
	const entry = entries?.find(
		(candidate) =>
			candidate.documents === undefined ||
			picomatch(candidate.documents, GLOB_MATCH_OPTIONS)(folderPath),
	);
	if (entry === undefined) {
		return undefined;
	}
	const filter: AppliesTo = {};
	if (entry.include !== undefined) {
		filter.include = entry.include;
	}
	if (entry.exclude !== undefined) {
		filter.exclude = entry.exclude;
	}
	return filter;
}

/** Derive a rule id from a document path relative to its mapped folder. */
function deriveRuleId(
	folderPath: string,
	idPrefix: string | undefined,
): string {
	const derived = folderPath.slice(0, -".md".length).replaceAll("/", ".");
	return idPrefix === undefined ? derived : `${idPrefix}.${derived}`;
}

/** The bundle root directory and naming context of one resolved source. */
interface ResolvedBundle {
	root: string;
	/** The rule id prefix added to every derived id of this source. */
	idPrefix?: string;
	/** The readable source name used by duplicate-identity errors. */
	label: string;
	/** Return the readable name of one document for warnings. */
	documentLabel: (bundlePath: string) => string;
}

/**
 * Load the rules of one resolved bundle: discover the documents under each
 * mapped folder, filter them, parse them, and append the enforced rules. A
 * document with `superseded_by` is not enforced. Invalid documents append
 * warnings instead (specs/configuration.md).
 */
async function loadBundleRules(
	bundle: ResolvedBundle,
	folderMappings: readonly FolderMapping[],
	rules: Rule[],
	ruleSources: Map<string, string>,
	warnings: RuleWarning[],
): Promise<void> {
	const discovered: DiscoveredDocument[] = [];
	for (const mapping of folderMappings) {
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

		const keepDocument = compileDocumentFilter(mapping.documents);
		for (const absolutePath of await walkMarkdownFiles(folderDirectory)) {
			const folderPath = portableRelativePath(folderDirectory, absolutePath);
			if (!keepDocument(folderPath)) {
				continue;
			}
			discovered.push({
				absolutePath,
				bundlePath: portableRelativePath(bundle.root, absolutePath),
				folderPath,
				mapping,
			});
		}
	}

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
		const frontmatter: RuleFrontmatter = parsed.frontmatter;

		// A superseded document is not enforced; suppressions, not the loader,
		// will read aliases (specs/configuration.md superseded documents).
		const enforced =
			frontmatter.superseded_by === undefined &&
			frontmatter.status === "stable" &&
			(frontmatter.adr_status === undefined ||
				frontmatter.adr_status === "accepted");
		if (!enforced) {
			continue;
		}

		const id = deriveRuleId(document.folderPath, bundle.idPrefix);
		if (!RULE_ID_PATTERN.test(id)) {
			warnings.push({
				document: documentName,
				problem: `Derived id '${id}' does not match the rule id grammar.`,
			});
			continue;
		}

		const previousSource = ruleSources.get(id);
		if (previousSource !== undefined) {
			throw new ConfigurationResolutionError(
				`Rule ID '${id}' in '${bundle.label}' duplicates the rule from '${previousSource}'. Set 'id_prefix' on a source to resolve the conflict.`,
			);
		}
		ruleSources.set(id, bundle.label);

		const rule: Rule = {
			id,
			level: document.mapping.level,
			title:
				frontmatter.title ?? path.posix.basename(document.folderPath, ".md"),
			body: parsed.body,
		};
		if (frontmatter.description !== undefined) {
			rule.description = frontmatter.description;
		}
		const appliesTo = selectAppliesTo(
			document.mapping.applies_to,
			document.folderPath,
		);
		if (appliesTo !== undefined) {
			rule.applies_to = appliesTo;
		}
		rules.push(rule);
	}
}

/**
 * Load the rules that the configuration's knowledge sources declare
 * (specs/configuration.md resolution).
 *
 * Sources follow their branch: each Git `branch` resolves to its current commit
 * at the start of the run, and the resolved commits are returned for the
 * report. A bad document is skipped with a warning and never fails the run; a
 * configuration mistake — a missing folder, an unreachable source, a
 * duplicate identity — fails the run.
 */
export async function loadRules(
	repositoryRoot: string,
	options: LoadRulesOptions = {},
): Promise<Resolution> {
	const canonicalRepositoryRoot =
		await canonicalizeRepositoryRoot(repositoryRoot);

	const entryFile = await findEntryFile(canonicalRepositoryRoot);
	let entryText: string;
	try {
		entryText = await readFile(entryFile.path, "utf8");
	} catch (error) {
		throw new ConfigurationResolutionError(
			`Cannot read configuration '${entryFile.name}': ${errorMessage(error)}`,
		);
	}
	const configuration = loadConfiguration(entryText, entryFile.name);

	const ownsGitSourceStore = options.gitSourceStore === undefined;
	const gitSourceStore =
		options.gitSourceStore ?? createTemporaryGitSourceStore();

	const rules: Rule[] = [];
	const ruleSources = new Map<string, string>();
	const warnings: RuleWarning[] = [];
	const gitSources: ResolvedGitSource[] = [];
	const resolvedBranches = new Map<
		string,
		Promise<{ branch: string; commit: string }>
	>();
	const checkouts = new Map<string, Promise<string>>();

	function resolveBranch(
		source: GitKnowledgeSource,
	): Promise<{ branch: string; commit: string }> {
		const key = JSON.stringify([source.repository, source.branch ?? null]);
		let resolved = resolvedBranches.get(key);
		if (resolved === undefined) {
			resolved = resolveBranchCommit(
				source.repository,
				source.branch,
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
		const key = JSON.stringify([repository, commit]);
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
		if ("repository" in source) {
			options.reportProgress?.reportResolvingRevision(
				source.repository,
				source.branch ?? "HEAD",
			);
			const { branch, commit } = await resolveBranch(source);
			if (
				!gitSources.some(
					(resolved) =>
						resolved.repository === source.repository &&
						resolved.branch === branch,
				)
			) {
				gitSources.push({ repository: source.repository, branch, commit });
			}
			const checkoutRoot = await provideCheckout(source.repository, commit);
			let bundleRoot = checkoutRoot;
			if (source.path !== undefined) {
				const candidate = path.resolve(checkoutRoot, source.path);
				if (!isWithinRoot(checkoutRoot, candidate)) {
					throw new ConfigurationResolutionError(
						`Knowledge source path '${source.path}' escapes the repository '${source.repository}'.`,
					);
				}
				try {
					bundleRoot = await realpath(candidate);
				} catch (error) {
					throw new ConfigurationResolutionError(
						`Cannot access path '${source.path}' in '${source.repository}': ${errorMessage(error)}`,
					);
				}
				if (!isWithinRoot(checkoutRoot, bundleRoot)) {
					throw new ConfigurationResolutionError(
						`Knowledge source path '${source.path}' resolves outside the repository '${source.repository}'.`,
					);
				}
			}
			const label = `${source.repository}@${branch}`;
			return {
				root: bundleRoot,
				idPrefix: source.id_prefix,
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
			idPrefix: source.id_prefix,
			label,
			documentLabel: (bundlePath) => `${label}/${bundlePath}`,
		};
	}

	try {
		for (const source of configuration.sources) {
			const bundle = await resolveBundle(source);
			await loadBundleRules(
				bundle,
				source.folders,
				rules,
				ruleSources,
				warnings,
			);
		}
		return { rules, gitSources, warnings };
	} finally {
		if (ownsGitSourceStore) {
			await gitSourceStore.dispose();
		}
	}
}
