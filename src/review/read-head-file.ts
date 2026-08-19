import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	Type,
} from "@earendil-works/pi-ai";
import { errorMessage } from "../utils/errors.js";

/**
 * The tool that lets a review agent read more of the head checkout on demand.
 *
 * The agent uses it when a hunk alone is not enough to judge a rule. The
 * executor confines every read to the head checkout, so the agent cannot read
 * outside it (specs/review.md security considerations).
 */
export const readHeadFileTool: Tool = {
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
};

/** Build a tool result that reports a failed or denied read to the agent. */
function readError(toolCall: ToolCall, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [{ type: "text", text }],
		isError: true,
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

/**
 * Run one `read_file` tool call against the head checkout.
 *
 * It resolves the requested path through the real head checkout root and
 * denies any path that escapes it, including through a symlink. The change is
 * untrusted, so the boundary check is the security boundary, not the agent's
 * cooperation (specs/review.md security considerations).
 */
export async function executeReadHeadFile(
	headCheckoutDir: string,
	toolCall: ToolCall,
): Promise<ToolResultMessage> {
	const requestedPath = String(toolCall.arguments.path ?? "");
	const realRoot = await realpath(headCheckoutDir);
	const resolved = path.resolve(realRoot, requestedPath);

	let realTarget: string;
	try {
		realTarget = await realpath(resolved);
	} catch (error) {
		return readError(
			toolCall,
			`read_file failed for '${requestedPath}': ${errorMessage(error)}`,
		);
	}
	if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
		return readError(
			toolCall,
			`read_file denied: '${requestedPath}' is outside the head checkout.`,
		);
	}

	let content: string;
	try {
		content = await readFile(realTarget, "utf8");
	} catch (error) {
		return readError(
			toolCall,
			`read_file failed for '${requestedPath}': ${errorMessage(error)}`,
		);
	}

	const startLine = toCount(toolCall.arguments.start_line);
	const endLine = toCount(toolCall.arguments.end_line);
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [
			{ type: "text", text: numberedLines(content, startLine, endLine) },
		],
		isError: false,
		timestamp: Date.now(),
	};
}

/** Read a positive line number argument, or undefined when it is absent. */
function toCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}
