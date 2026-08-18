import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAutomationModels,
	createStandardsModels,
} from "./models-runtime.js";

const temporaryDirectories: string[] = [];
const environmentRestorations: Array<() => void> = [];

async function createAuthFilePath(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-models-"));
	temporaryDirectories.push(directory);
	return path.join(directory, "standards", "auth.json");
}

function setEnvironmentValue(name: string, value: string): void {
	const previous = process.env[name];
	environmentRestorations.push(() => {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	});
	process.env[name] = value;
}

afterEach(async () => {
	for (const restore of environmentRestorations.splice(0)) {
		restore();
	}
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("createAutomationModels", () => {
	it("exposes only an allowed API key variable to the SDK", async () => {
		const models = createAutomationModels({
			environment: { ANTHROPIC_API_KEY: "action-key" },
			allowedEnvironmentVariables: ["ANTHROPIC_API_KEY"],
		});

		const check = await models.checkAuth("anthropic");

		expect(check?.type).toBe("api_key");
	});

	it("hides an environment variable that the Action does not accept", async () => {
		const models = createAutomationModels({
			environment: { ANTHROPIC_API_KEY: "action-key" },
			allowedEnvironmentVariables: [],
		});

		const check = await models.checkAuth("anthropic");

		expect(check).toBeUndefined();
	});
});

describe("createStandardsModels", () => {
	it("registers the built-in providers", async () => {
		const { models } = createStandardsModels({
			authFilePath: await createAuthFilePath(),
		});

		expect(models.getProvider("anthropic")).toBeDefined();
		expect(models.getProvider("openai")).toBeDefined();
	});

	it("prefers a stored credential over an ambient environment variable", async () => {
		const authFilePath = await createAuthFilePath();
		await mkdir(path.dirname(authFilePath), { recursive: true });
		await writeFile(
			authFilePath,
			JSON.stringify({ anthropic: { type: "api_key", key: "stored-key" } }),
			{ encoding: "utf8" },
		);
		setEnvironmentValue("ANTHROPIC_API_KEY", "ambient-key");

		const { models } = createStandardsModels({ authFilePath });
		const auth = await models.getAuth("anthropic");

		expect(auth?.auth.apiKey).toBe("stored-key");
	});
});
