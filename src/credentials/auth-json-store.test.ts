import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	AuthCredentialStoreError,
	createAuthJsonStore,
} from "./auth-json-store.js";

const temporaryDirectories: string[] = [];

async function createAuthFilePath(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-auth-"));
	temporaryDirectories.push(directory);
	return path.join(directory, "standards", "auth.json");
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("createAuthJsonStore", () => {
	it("treats a missing file as an empty store", async () => {
		const store = createAuthJsonStore({
			authFilePath: await createAuthFilePath(),
		});
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});

	it("writes a credential through modify and reads it back", async () => {
		const authFilePath = await createAuthFilePath();
		const store = createAuthJsonStore({ authFilePath });
		const credential: Credential = { type: "api_key", key: "secret-key" };

		const written = await store.modify("openai", async () => credential);

		expect(written).toEqual(credential);
		expect(await store.read("openai")).toEqual(credential);
	});

	it("lists only provider id and type, never the secret", async () => {
		const authFilePath = await createAuthFilePath();
		const store = createAuthJsonStore({ authFilePath });
		await store.modify("openai", async () => ({
			type: "api_key",
			key: "secret-key",
		}));

		const listed = await store.list();

		expect(listed).toEqual([{ providerId: "openai", type: "api_key" }]);
	});

	it("preserves other entries and extra OAuth fields on later writes", async () => {
		const authFilePath = await createAuthFilePath();
		const store = createAuthJsonStore({ authFilePath });
		await store.modify("openai", async () => ({
			type: "api_key",
			key: "openai-key",
		}));
		await store.modify("anthropic", async () => ({
			type: "oauth",
			access: "access-token",
			refresh: "refresh-token",
			expires: 100,
			account: "person@example.com",
		}));

		await store.modify("anthropic", async (current) => {
			if (current?.type !== "oauth") {
				throw new Error("expected oauth credential");
			}
			return { ...current, access: "rotated-token", expires: 200 };
		});

		expect(await store.read("openai")).toEqual({
			type: "api_key",
			key: "openai-key",
		});
		expect(await store.read("anthropic")).toEqual({
			type: "oauth",
			access: "rotated-token",
			refresh: "refresh-token",
			expires: 200,
			account: "person@example.com",
		});
	});

	it("leaves an entry unchanged when modify returns undefined", async () => {
		const authFilePath = await createAuthFilePath();
		const store = createAuthJsonStore({ authFilePath });
		await store.modify("openai", async () => ({
			type: "api_key",
			key: "openai-key",
		}));

		const result = await store.modify("openai", async () => undefined);

		expect(result).toEqual({ type: "api_key", key: "openai-key" });
		expect(await store.read("openai")).toEqual({
			type: "api_key",
			key: "openai-key",
		});
	});

	it("removes a credential through delete and ignores a missing entry", async () => {
		const authFilePath = await createAuthFilePath();
		const store = createAuthJsonStore({ authFilePath });
		await store.modify("openai", async () => ({
			type: "api_key",
			key: "openai-key",
		}));

		await store.delete("openai");
		expect(await store.read("openai")).toBeUndefined();

		await expect(store.delete("openai")).resolves.toBeUndefined();
	});

	it("rejects invalid JSON and does not replace the file", async () => {
		const authFilePath = await createAuthFilePath();
		await mkdir(path.dirname(authFilePath), { recursive: true });
		await writeFile(authFilePath, "{ not json", { encoding: "utf8" });
		const store = createAuthJsonStore({ authFilePath });

		await expect(store.read("openai")).rejects.toBeInstanceOf(
			AuthCredentialStoreError,
		);
		expect(await readFile(authFilePath, "utf8")).toBe("{ not json");
	});

	it("rejects a credential entry whose env value is not a string", async () => {
		const authFilePath = await createAuthFilePath();
		await mkdir(path.dirname(authFilePath), { recursive: true });
		await writeFile(
			authFilePath,
			JSON.stringify({
				"google-vertex": { type: "api_key", env: { GOOGLE_CLOUD_PROJECT: 5 } },
			}),
			{ encoding: "utf8" },
		);
		const store = createAuthJsonStore({ authFilePath });

		await expect(store.list()).rejects.toBeInstanceOf(AuthCredentialStoreError);
	});

	it.runIf(process.platform !== "win32")(
		"creates the directory with mode 0700 and the file with mode 0600",
		async () => {
			const authFilePath = await createAuthFilePath();
			const store = createAuthJsonStore({ authFilePath });
			await store.modify("openai", async () => ({
				type: "api_key",
				key: "openai-key",
			}));

			const directoryStat = await stat(path.dirname(authFilePath));
			const fileStat = await stat(authFilePath);
			expect(directoryStat.mode & 0o777).toBe(0o700);
			expect(fileStat.mode & 0o777).toBe(0o600);
		},
	);

	it("serializes concurrent modify calls so no update is lost", async () => {
		const authFilePath = await createAuthFilePath();
		const store = createAuthJsonStore({ authFilePath });
		await store.modify("openai", async () => ({
			type: "api_key",
			key: "counter-0",
		}));

		const increments = Array.from({ length: 5 }, () =>
			store.modify("openai", async (current) => {
				if (current?.type !== "api_key" || current.key === undefined) {
					throw new Error("expected api_key credential");
				}
				const value = Number.parseInt(current.key.split("-")[1] ?? "0", 10);
				return { type: "api_key", key: `counter-${value + 1}` };
			}),
		);
		await Promise.all(increments);

		expect(await store.read("openai")).toEqual({
			type: "api_key",
			key: "counter-5",
		});
	});
});
