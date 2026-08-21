import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	createTerminalLoginInteraction,
	resolveSelectAnswer,
} from "./terminal-login-interaction.js";

const options = [
	{ id: "pro", label: "Claude Pro" },
	{ id: "team", label: "Claude Team", description: "Shared plan" },
];

describe("resolveSelectAnswer", () => {
	it("matches an exact option id", () => {
		expect(resolveSelectAnswer(options, "team")).toBe("team");
	});

	it("matches a one-based position", () => {
		expect(resolveSelectAnswer(options, "1")).toBe("pro");
	});

	it("returns undefined for an out-of-range position", () => {
		expect(resolveSelectAnswer(options, "3")).toBeUndefined();
	});

	it("returns undefined for an unknown answer", () => {
		expect(resolveSelectAnswer(options, "enterprise")).toBeUndefined();
	});
});

describe("createTerminalLoginInteraction prompt", () => {
	function captureAnswer(promptType: "text" | "secret") {
		const input = new PassThrough();
		const output = new PassThrough();
		let text = "";
		output.on("data", (chunk) => {
			text += chunk.toString();
		});
		const interaction = createTerminalLoginInteraction({ input, output });
		const pending = interaction.prompt({
			type: promptType,
			message: "API key:",
		});
		input.write("typed-value\n");
		return { pending, outputText: () => text };
	}

	it("does not echo a secret answer", async () => {
		const { pending, outputText } = captureAnswer("secret");
		await expect(pending).resolves.toBe("typed-value");
		expect(outputText()).toContain("API key:");
		expect(outputText()).not.toContain("typed-value");
	});

	it("echoes a text answer", async () => {
		const { pending, outputText } = captureAnswer("text");
		await expect(pending).resolves.toBe("typed-value");
		expect(outputText()).toContain("typed-value");
	});
});

describe("createTerminalLoginInteraction notify", () => {
	function captureNotice(
		event: Parameters<
			ReturnType<typeof createTerminalLoginInteraction>["notify"]
		>[0],
	): string {
		const output = new PassThrough();
		let text = "";
		output.on("data", (chunk) => {
			text += chunk.toString();
		});
		createTerminalLoginInteraction({ output }).notify(event);
		return text;
	}

	it("shows an authentication URL and its instructions", () => {
		const text = captureNotice({
			type: "auth_url",
			url: "https://example.com/authorize",
			instructions: "Approve the request in your browser.",
		});
		expect(text).toContain("https://example.com/authorize");
		expect(text).toContain("Approve the request in your browser.");
	});

	it("shows a device code and its verification URL", () => {
		const text = captureNotice({
			type: "device_code",
			userCode: "WXYZ-1234",
			verificationUri: "https://example.com/device",
		});
		expect(text).toContain("WXYZ-1234");
		expect(text).toContain("https://example.com/device");
	});
});
