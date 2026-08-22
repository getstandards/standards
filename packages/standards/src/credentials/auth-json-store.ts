import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";
import { z } from "zod/v4";
import { errorMessage, isMissingFileError } from "../utils/errors.js";
import { withAuthFileLock } from "./auth-file-lock.js";

/**
 * The stored credential shapes in `auth.json`, matching the SDK `Credential`
 * type. Loose objects preserve extra provider-owned fields so a refresh and
 * write does not drop them. Each api-key `env` value must be a string.
 */
const storedCredentialSchema = z.discriminatedUnion("type", [
	z.looseObject({
		type: z.literal("api_key"),
		key: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
	z.looseObject({
		type: z.literal("oauth"),
		access: z.string(),
		refresh: z.string(),
		expires: z.number(),
	}),
]);

/** The whole `auth.json` document: one SDK credential per SDK provider id. */
const authDocumentSchema = z.record(z.string(), storedCredentialSchema);

type AuthDocument = Record<string, Credential>;

/** Directory mode that keeps the credential directory readable by its owner only. */
const AUTH_DIRECTORY_MODE = 0o700;

/** File mode that keeps the credential file readable by its owner only. */
const AUTH_FILE_MODE = 0o600;

/** An error raised when the credential file cannot be read or its content is invalid. */
export class AuthCredentialStoreError extends Error {
	public constructor(
		public readonly authFilePath: string,
		public readonly problem: string,
	) {
		super(`Standards credential store failed at ${authFilePath}: ${problem}`);
		this.name = "AuthCredentialStoreError";
	}
}

/** Runtime values used to open the `auth.json` credential store. */
export interface AuthJsonStoreOptions {
	authFilePath: string;
	platform?: NodeJS.Platform;
}

/** Read and validate the whole `auth.json` document, or return an empty one when it is missing. */
async function readAuthDocument(authFilePath: string): Promise<AuthDocument> {
	let sourceText: string;
	try {
		sourceText = await readFile(authFilePath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return {};
		}
		throw new AuthCredentialStoreError(
			authFilePath,
			`Cannot read credential file: ${errorMessage(error)}`,
		);
	}

	let result: ReturnType<typeof authDocumentSchema.safeParse>;
	try {
		result = authDocumentSchema.safeParse(JSON.parse(sourceText));
	} catch (error) {
		throw new AuthCredentialStoreError(
			authFilePath,
			`Credential file is not valid JSON: ${errorMessage(error)}`,
		);
	}

	if (!result.success) {
		const issue = result.error.issues[0];
		const location = issue?.path.join(".") || "(document)";
		throw new AuthCredentialStoreError(
			authFilePath,
			`Invalid credential entry at '${location}': ${issue?.message ?? "invalid credential shape"}`,
		);
	}
	return result.data;
}

/** Write the whole `auth.json` document atomically with owner-only permissions. */
async function writeAuthDocument(
	authFilePath: string,
	platform: NodeJS.Platform,
	document: AuthDocument,
): Promise<void> {
	const directory = path.dirname(authFilePath);
	await mkdir(directory, { recursive: true });
	if (platform !== "win32") {
		await chmod(directory, AUTH_DIRECTORY_MODE);
	}

	const temporaryPath = `${authFilePath}.${process.pid}.tmp`;
	const serialized = `${JSON.stringify(document, null, 2)}\n`;
	await writeFile(temporaryPath, serialized, {
		encoding: "utf8",
		mode: AUTH_FILE_MODE,
	});
	if (platform !== "win32") {
		await chmod(temporaryPath, AUTH_FILE_MODE);
	}
	try {
		await rename(temporaryPath, authFilePath);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

/**
 * Open the persistent `auth.json` credential store that `standards auth login` and
 * `standards auth logout` write, and that the pi AI SDK reads and refreshes.
 *
 * The store implements the SDK `CredentialStore` contract. It holds one entry
 * per SDK provider id. `modify` is the only write path and runs a serialized
 * read-modify-write under a cross-process file lock, so a rotating OAuth token
 * is never refreshed twice at once. Reads never expose secret values through
 * `list`. A missing file is an empty store; an invalid file raises a
 * diagnostic and is never replaced with an empty file.
 */
export function createAuthJsonStore(
	options: AuthJsonStoreOptions,
): CredentialStore {
	const { authFilePath } = options;
	const platform = options.platform ?? process.platform;

	return {
		async read(providerId): Promise<Credential | undefined> {
			const document = await readAuthDocument(authFilePath);
			return document[providerId];
		},

		async list(): Promise<readonly CredentialInfo[]> {
			const document = await readAuthDocument(authFilePath);
			return Object.entries(document).map(([providerId, credential]) => ({
				providerId,
				type: credential.type,
			}));
		},

		async modify(providerId, fn): Promise<Credential | undefined> {
			return withAuthFileLock(authFilePath, async () => {
				const document = await readAuthDocument(authFilePath);
				const current = document[providerId];
				const next = await fn(current);
				if (next === undefined) {
					return current;
				}
				document[providerId] = next;
				await writeAuthDocument(authFilePath, platform, document);
				return next;
			});
		},

		async delete(providerId): Promise<void> {
			await withAuthFileLock(authFilePath, async () => {
				const document = await readAuthDocument(authFilePath);
				if (!(providerId in document)) {
					return;
				}
				delete document[providerId];
				await writeAuthDocument(authFilePath, platform, document);
			});
		},
	};
}
