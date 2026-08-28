import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
	type Static,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	Type,
	validateToolCall,
} from "@earendil-works/pi-ai";
import { errorMessage } from "../utils/errors.js";

/**
 * The tool that lets a review agent read more of the head checkout on demand.
 *
 * The agent uses it when a hunk alone is not enough to judge a rule. The
 * executor confines every read to the head checkout, so the agent cannot read
 * outside it (specs/review.md security considerations).
 */
export const readHeadFileTool = {
	name: "read_file",
	description:
		"Read a file from the head checkout to see more context around a hunk. " +
		"The path is repository-relative. Give start_line and end_line to read " +
		"only a range. Output lines are prefixed with their 1-based line number.",
	parameters: Type.Object({
		path: Type.String({
			description: "Repository-relative path inside the head checkout.",
		}),
		start_line: Type.Optional(
			Type.Integer({ description: "First line to read, 1-based." }),
		),
		end_line: Type.Optional(
			Type.Integer({ description: "Last line to read, 1-based." }),
		),
	}),
} as const satisfies Tool;

/** The outcome of a head checkout read: the numbered text, or why it failed. */
export type HeadRegionResult =
	| { ok: true; text: string }
	| { ok: false; message: string };

/**
 * Resolve a repository-relative path to its real path inside the head
 * checkout, or return why the read failed.
 *
 * It resolves the requested path through the real head checkout root and
 * denies any path that escapes it, including through a symlink. The change is
 * untrusted, so the boundary check is the security boundary, not the agent's
 * cooperation (specs/review.md security considerations).
 */
async function resolveHeadPath(
	headCheckoutDir: string,
	relativePath: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
	const realRoot = await realpath(headCheckoutDir);
	const resolved = path.resolve(realRoot, relativePath);

	let realTarget: string;
	try {
		realTarget = await realpath(resolved);
	} catch (error) {
		return {
			ok: false,
			message: `read_file failed for '${relativePath}': ${errorMessage(error)}`,
		};
	}
	if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
		return {
			ok: false,
			message: `read_file denied: '${relativePath}' is outside the head checkout.`,
		};
	}
	return { ok: true, path: realTarget };
}

/**
 * Read a line range from the head checkout, confined to it.
 *
 * Output lines carry their 1-based line number. A missing or denied path
 * returns the failure message as text, so the agent can read it as a result.
 */
export async function readHeadRegion(
	headCheckoutDir: string,
	relativePath: string,
	startLine?: number,
	endLine?: number,
): Promise<HeadRegionResult> {
	const resolved = await resolveHeadPath(headCheckoutDir, relativePath);
	if (!resolved.ok) {
		return resolved;
	}

	let content: string;
	try {
		content = await readFile(resolved.path, "utf8");
	} catch (error) {
		return {
			ok: false,
			message: `read_file failed for '${relativePath}': ${errorMessage(error)}`,
		};
	}
	return { ok: true, text: numberedLines(content, startLine, endLine) };
}

/**
 * Read a head checkout file as its split lines, or undefined when the file is
 * missing or denied.
 *
 * The verification step uses this to check a candidate suggested change
 * against the head revision before the agent runs (specs/review.md step 4).
 */
export async function readHeadFileLines(
	headCheckoutDir: string,
	relativePath: string,
): Promise<string[] | undefined> {
	const resolved = await resolveHeadPath(headCheckoutDir, relativePath);
	if (!resolved.ok) {
		return undefined;
	}
	try {
		const content = await readFile(resolved.path, "utf8");
		const lines = content.split("\n");
		// A final line break terminates the last line; it is not an extra
		// empty line, so a line range must not be able to reach past it.
		if (lines.at(-1) === "") {
			lines.pop();
		}
		return lines;
	} catch {
		return undefined;
	}
}

/**
 * Run one `read_file` tool call against the head checkout.
 *
 * It returns a tool result the agent can read, whether the read succeeded or
 * the path was denied or missing.
 */
export async function executeReadHeadFile(
	headCheckoutDir: string,
	toolCall: ToolCall,
): Promise<ToolResultMessage> {
	const toolArguments = validateToolCall(
		[readHeadFileTool],
		toolCall,
	) as Static<typeof readHeadFileTool.parameters>;
	const region = await readHeadRegion(
		headCheckoutDir,
		toolArguments.path,
		toolArguments.start_line,
		toolArguments.end_line,
	);
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [{ type: "text", text: region.ok ? region.text : region.message }],
		isError: !region.ok,
		timestamp: Date.now(),
	};
}

/** Return the file text sliced to a 1-based inclusive line range, with line numbers. */
function numberedLines(
	content: string,
	startLine: number | undefined,
	endLine: number | undefined,
): string {
	const lines = content.split("\n");
	const first = startLine === undefined ? 1 : Math.max(1, startLine);
	const last =
		endLine === undefined ? lines.length : Math.min(lines.length, endLine);
	const selected: string[] = [];
	for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
		selected.push(`${lineNumber}\t${lines[lineNumber - 1] ?? ""}`);
	}
	return selected.join("\n");
}
