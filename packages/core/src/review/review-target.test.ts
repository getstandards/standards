import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../utils/git.js";
import type { ChangedFile } from "./change-diff.js";
import {
	filterChangedFilesByTargets,
	normalizeTarget,
	ReviewTargetError,
	targetMatchesPath,
	validateTargets,
} from "./review-target.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function changedFile(
	filePath: string,
	status: ChangedFile["status"] = "modified",
): ChangedFile {
	return { status, path: filePath, binary: false, hunks: [] };
}

describe("normalizeTarget", () => {
	it("strips trailing slashes", () => {
		expect(normalizeTarget("src/")).toBe("src");
		expect(normalizeTarget("src")).toBe("src");
	});
});

describe("targetMatchesPath", () => {
	it("matches an equal path and a directory prefix", () => {
		expect(targetMatchesPath("src/billing", "src/billing/invoice.ts")).toBe(
			true,
		);
		expect(
			targetMatchesPath("src/billing/invoice.ts", "src/billing/invoice.ts"),
		).toBe(true);
		expect(targetMatchesPath("src/bill", "src/billing/invoice.ts")).toBe(false);
	});
});

describe("filterChangedFilesByTargets", () => {
	it("keeps every file when there is no target", () => {
		const files = [changedFile("a.ts"), changedFile("docs/b.md")];
		expect(filterChangedFilesByTargets(files, [])).toEqual(files);
	});

	it("keeps only the files a target matches", () => {
		const files = [
			changedFile("src/a.ts"),
			changedFile("docs/b.md"),
			changedFile("src/nested/c.ts"),
		];
		expect(filterChangedFilesByTargets(files, ["src"])).toEqual([
			files[0],
			files[2],
		]);
	});

	it("matches a deleted file through its base path", () => {
		const files = [changedFile("old/gone.ts", "deleted")];
		expect(filterChangedFilesByTargets(files, ["old"])).toEqual(files);
	});
});

describe("validateTargets", () => {
	async function initRepositoryWithHead(): Promise<{
		directory: string;
		headRevision: string;
	}> {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "standards-target-"),
		);
		temporaryDirectories.push(directory);
		await runGit(["init", "-q", "-b", "main"], directory);
		await runGit(["config", "user.email", "test@example.com"], directory);
		await runGit(["config", "user.name", "Test"], directory);
		await mkdir(path.join(directory, "src"));
		await writeFile(path.join(directory, "src", "kept.ts"), "export {};\n");
		await runGit(["add", "-A"], directory);
		await runGit(["commit", "-q", "-m", "head"], directory);
		const headRevision = await runGit(["rev-parse", "HEAD"], directory);
		return { directory, headRevision };
	}

	it("accepts a file, a directory, and a deleted file's base path", async () => {
		const { directory, headRevision } = await initRepositoryWithHead();

		await expect(
			validateTargets({
				targets: ["src/kept.ts", "src", "old/gone.ts"],
				scope: { kind: "commits", baseRevision: headRevision, headRevision },
				workingDirectory: directory,
				changedFiles: [changedFile("old/gone.ts", "deleted")],
			}),
		).resolves.toBeUndefined();
	});

	it("rejects a target that exists nowhere", async () => {
		const { directory, headRevision } = await initRepositoryWithHead();

		await expect(
			validateTargets({
				targets: ["missing.ts"],
				scope: { kind: "commits", baseRevision: headRevision, headRevision },
				workingDirectory: directory,
				changedFiles: [],
			}),
		).rejects.toThrow(ReviewTargetError);
	});

	it("accepts an untracked file in a working-tree scope", async () => {
		const { directory, headRevision } = await initRepositoryWithHead();
		await writeFile(path.join(directory, "src", "new.ts"), "export {};\n");

		await expect(
			validateTargets({
				targets: ["src/new.ts"],
				scope: { kind: "working-tree", baseRevision: headRevision },
				workingDirectory: directory,
				changedFiles: [],
			}),
		).resolves.toBeUndefined();
	});

	it("rejects a target that escapes the repository root", async () => {
		const { directory, headRevision } = await initRepositoryWithHead();

		await expect(
			validateTargets({
				targets: ["../outside.ts"],
				scope: { kind: "working-tree", baseRevision: headRevision },
				workingDirectory: directory,
				changedFiles: [],
			}),
		).rejects.toThrow(ReviewTargetError);
	});

	it("rejects a working-tree-only target in a staged scope", async () => {
		const { directory, headRevision } = await initRepositoryWithHead();
		await writeFile(path.join(directory, "src", "new.ts"), "export {};\n");

		await expect(
			validateTargets({
				targets: ["src"],
				scope: { kind: "staged", baseRevision: headRevision },
				workingDirectory: directory,
				changedFiles: [],
			}),
		).resolves.toBeUndefined();
		await expect(
			validateTargets({
				targets: ["src/new.ts"],
				scope: { kind: "staged", baseRevision: headRevision },
				workingDirectory: directory,
				changedFiles: [],
			}),
		).rejects.toThrow(ReviewTargetError);
	});
});
