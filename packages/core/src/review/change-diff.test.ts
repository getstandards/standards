import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../utils/git.js";
import { computeChange } from "./change-diff.js";

/** The Git SHA-1 empty tree object, used as the base of a full review. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const temporaryDirectories: string[] = [];

async function initRepository(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "standards-change-"));
	temporaryDirectories.push(directory);
	await runGit(["init", "-q", "-b", "main"], directory);
	await runGit(["config", "user.email", "test@example.com"], directory);
	await runGit(["config", "user.name", "Test"], directory);
	return directory;
}

async function commitAll(directory: string, message: string): Promise<string> {
	await runGit(["add", "-A"], directory);
	await runGit(["commit", "-q", "-m", message], directory);
	return runGit(["rev-parse", "HEAD"], directory);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("computeChange", () => {
	it("reports added, modified, and deleted files with hunks", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "keep.ts"), "const a = 1;\n");
		await writeFile(path.join(directory, "old.ts"), "const b = 2;\n");
		const base = await commitAll(directory, "base");

		await writeFile(path.join(directory, "keep.ts"), "const a = 100;\n");
		await writeFile(path.join(directory, "new.ts"), "const c = 3;\n");
		await rm(path.join(directory, "old.ts"));
		const head = await commitAll(directory, "head");

		const files = await computeChange({
			scope: { kind: "commits", baseRevision: base, headRevision: head },
			workingDirectory: directory,
		});

		const byPath = new Map(files.map((file) => [file.path, file]));
		expect(byPath.get("keep.ts")?.status).toBe("modified");
		expect(byPath.get("new.ts")?.status).toBe("added");
		expect(byPath.get("old.ts")?.status).toBe("deleted");

		const modified = byPath.get("keep.ts");
		expect(modified?.hunks).toHaveLength(1);
		expect(modified?.hunks[0]?.lines).toContain("-const a = 1;");
		expect(modified?.hunks[0]?.lines).toContain("+const a = 100;");
	});

	it("reports every tracked file as added for a full review", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "a.ts"), "const a = 1;\n");
		await writeFile(path.join(directory, "b.ts"), "const b = 2;\n");
		const head = await commitAll(directory, "head");

		const files = await computeChange({
			scope: { kind: "commits", baseRevision: EMPTY_TREE, headRevision: head },
			workingDirectory: directory,
		});

		expect(files).toHaveLength(2);
		expect(files.every((file) => file.status === "added")).toBe(true);
	});

	it("detects a rename and keeps the old path as the base path", async () => {
		const directory = await initRepository();
		await writeFile(
			path.join(directory, "old-name.ts"),
			"export const value = 1;\n",
		);
		const base = await commitAll(directory, "base");

		await runGit(["mv", "old-name.ts", "new-name.ts"], directory);
		const head = await commitAll(directory, "head");

		const files = await computeChange({
			scope: { kind: "commits", baseRevision: base, headRevision: head },
			workingDirectory: directory,
		});

		expect(files).toHaveLength(1);
		expect(files[0]?.status).toBe("renamed");
		expect(files[0]?.path).toBe("new-name.ts");
		expect(files[0]?.basePath).toBe("old-name.ts");
	});

	it("marks a binary file and gives it no hunks", async () => {
		const directory = await initRepository();
		await runGit(["commit", "-q", "--allow-empty", "-m", "base"], directory);
		const base = await runGit(["rev-parse", "HEAD"], directory);

		await writeFile(
			path.join(directory, "logo.bin"),
			Buffer.from([0, 1, 2, 0, 255, 0]),
		);
		const head = await commitAll(directory, "head");

		const files = await computeChange({
			scope: { kind: "commits", baseRevision: base, headRevision: head },
			workingDirectory: directory,
		});

		expect(files).toHaveLength(1);
		expect(files[0]?.binary).toBe(true);
		expect(files[0]?.hunks).toHaveLength(0);
	});

	it("includes staged, unstaged, and untracked files in a working-tree scope", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "staged.ts"), "const a = 1;\n");
		await writeFile(path.join(directory, "unstaged.ts"), "const b = 2;\n");
		await writeFile(path.join(directory, ".gitignore"), "ignored.ts\n");
		const base = await commitAll(directory, "base");

		await writeFile(path.join(directory, "staged.ts"), "const a = 10;\n");
		await runGit(["add", "staged.ts"], directory);
		await writeFile(path.join(directory, "unstaged.ts"), "const b = 20;\n");
		await writeFile(path.join(directory, "untracked.ts"), "const c = 3;\n");
		await writeFile(path.join(directory, "ignored.ts"), "const d = 4;\n");

		const files = await computeChange({
			scope: { kind: "working-tree", baseRevision: base },
			workingDirectory: directory,
		});

		const byPath = new Map(files.map((file) => [file.path, file]));
		expect([...byPath.keys()].sort()).toEqual([
			"staged.ts",
			"unstaged.ts",
			"untracked.ts",
		]);
		expect(byPath.get("staged.ts")?.status).toBe("modified");
		expect(byPath.get("unstaged.ts")?.status).toBe("modified");
		expect(byPath.get("untracked.ts")?.status).toBe("added");
		expect(byPath.get("untracked.ts")?.hunks[0]?.lines).toEqual([
			"+const c = 3;",
		]);
	});

	it("reports only the staged changes in a staged scope", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "staged.ts"), "const a = 1;\n");
		await writeFile(path.join(directory, "unstaged.ts"), "const b = 2;\n");
		const head = await commitAll(directory, "head");

		await writeFile(path.join(directory, "staged.ts"), "const a = 10;\n");
		await runGit(["add", "staged.ts"], directory);
		await writeFile(path.join(directory, "unstaged.ts"), "const b = 20;\n");
		await writeFile(path.join(directory, "untracked.ts"), "const c = 3;\n");

		const files = await computeChange({
			scope: { kind: "staged", baseRevision: head },
			workingDirectory: directory,
		});

		expect(files.map((file) => file.path)).toEqual(["staged.ts"]);
		expect(files[0]?.hunks[0]?.lines).toContain("+const a = 10;");
	});

	it("reports every working-tree file as added for a full review", async () => {
		const directory = await initRepository();
		await writeFile(path.join(directory, "tracked.ts"), "const a = 1;\n");
		await commitAll(directory, "head");
		await writeFile(path.join(directory, "untracked.ts"), "const b = 2;\n");
		const emptyTree = await runGit(
			["hash-object", "-t", "tree", "/dev/null"],
			directory,
		);

		const files = await computeChange({
			scope: { kind: "working-tree", baseRevision: emptyTree },
			workingDirectory: directory,
		});

		expect(files.map((file) => file.path).sort()).toEqual([
			"tracked.ts",
			"untracked.ts",
		]);
		expect(files.every((file) => file.status === "added")).toBe(true);
	});
});
