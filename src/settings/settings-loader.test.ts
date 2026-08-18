import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadStandardsSettings,
	readStandardsSettingsFile,
	StandardsSettingsLoadError,
} from "./settings-loader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

/** Create a temporary directory for one settings file test. */
async function createSettingsTestDirectory(): Promise<string> {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "standards-settings-test-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

describe("loadStandardsSettings", () => {
	it("parses every version 1 settings field", () => {
		expect(
			loadStandardsSettings(`---
version: 1
cache_dir: /data/standards-cache
model: anthropic/claude-sonnet-5
evaluation_model: google/gemini-3.1-pro
verification_model: openai/gpt-5.5
`),
		).toEqual({
			version: 1,
			cache_dir: "/data/standards-cache",
			model: "anthropic/claude-sonnet-5",
			evaluation_model: "google/gemini-3.1-pro",
			verification_model: "openai/gpt-5.5",
		});
	});

	it("accepts a document that contains only the required version", () => {
		expect(loadStandardsSettings("version: 1\n")).toEqual({ version: 1 });
	});

	it("accepts a model identifier that contains a slash", () => {
		expect(
			loadStandardsSettings(
				"version: 1\nmodel: openrouter/anthropic/claude-sonnet-5\n",
			),
		).toEqual({
			version: 1,
			model: "openrouter/anthropic/claude-sonnet-5",
		});
	});

	it("rejects unknown settings fields with their YAML path", () => {
		expect(() =>
			loadStandardsSettings(
				"version: 1\nrules: []\n",
				"/home/user/.config/standards/settings.yml",
			),
		).toThrow(
			/home\/user\/\.config\/standards\/settings\.yml:rules: Unrecognized key: "rules"/,
		);
	});

	it.each(["claude-sonnet-5", "unknown/model", "anthropic/"])(
		"rejects the invalid model reference %s",
		(modelReference) => {
			expect(() =>
				loadStandardsSettings(`version: 1\nmodel: ${modelReference}\n`),
			).toThrow(/Expected a model reference in '<provider>\/<model>' form/);
		},
	);

	it("rejects an empty cache directory", () => {
		expect(() => loadStandardsSettings('version: 1\ncache_dir: ""\n')).toThrow(
			/cache_dir: Expected a non-empty cache directory path/,
		);
	});

	it("rejects more than one YAML document", () => {
		expect(() =>
			loadStandardsSettings("---\nversion: 1\n---\nversion: 1\n"),
		).toThrow(StandardsSettingsLoadError);
	});
});

describe("readStandardsSettingsFile", () => {
	it("returns no settings when the file is missing", async () => {
		const directory = await createSettingsTestDirectory();

		await expect(
			readStandardsSettingsFile(path.join(directory, "settings.yml")),
		).resolves.toBeUndefined();
	});

	it("reads and validates an existing settings file", async () => {
		const directory = await createSettingsTestDirectory();
		const settingsPath = path.join(directory, "settings.yml");
		await writeFile(settingsPath, "version: 1\ncache_dir: /cache\n");

		await expect(readStandardsSettingsFile(settingsPath)).resolves.toEqual({
			version: 1,
			cache_dir: "/cache",
		});
	});
});
