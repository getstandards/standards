import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { executeReadHeadFile } from "./read-head-file.js";

const temporaryDirectories: string[] = [];

async function makeCheckout(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-read-"));
	temporaryDirectories.push(directory);
	return directory;
}

function readFileCall(argumentsValue: ToolCall["arguments"]): ToolCall {
	return {
		type: "toolCall",
		id: "call-1",
		name: "read_file",
		arguments: argumentsValue,
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("executeReadHeadFile", () => {
	it("returns the requested line range with 1-based line numbers", async () => {
		const directory = await makeCheckout();
		await writeFile(path.join(directory, "a.ts"), "one\ntwo\nthree\nfour\n");

		const result = await executeReadHeadFile(
			directory,
			readFileCall({ path: "a.ts", start_line: 2, end_line: 3 }),
		);

		expect(result.isError).toBe(false);
		expect(result.content[0]).toEqual({
			type: "text",
			text: "2\ttwo\n3\tthree",
		});
	});

	it("denies a path that escapes the head checkout", async () => {
		const directory = await makeCheckout();
		await writeFile(path.join(directory, "..", "secret.txt"), "secret");

		const result = await executeReadHeadFile(
			directory,
			readFileCall({ path: "../secret.txt" }),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining("outside the head checkout"),
		});
	});
});
