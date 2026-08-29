import { describe, expect, it } from "vitest";
import { parseStandardsArgs, StandardsArgumentError } from "./command-args.js";

describe("parseStandardsArgs", () => {
	it("reviews the default change scope without an argument", () => {
		expect(parseStandardsArgs("")).toEqual({
			targets: [],
			staged: false,
			all: false,
		});
	});

	it("reads the scope options the CLI defines", () => {
		const parsed = parseStandardsArgs("--staged --base main src/pay.ts");

		expect(parsed.staged).toBe(true);
		expect(parsed.base).toBe("main");
		expect(parsed.targets).toEqual(["src/pay.ts"]);
	});

	it("accepts an option value after an equals sign", () => {
		expect(parseStandardsArgs("--range=main..HEAD").range).toBe("main..HEAD");
	});

	it("rejects an option value that is missing", () => {
		expect(() => parseStandardsArgs("--base")).toThrow(StandardsArgumentError);
	});

	it("rejects an unknown option instead of treating it as a target", () => {
		expect(() => parseStandardsArgs("--json")).toThrow(StandardsArgumentError);
	});

	it("rejects '--rule' and '--folder' together", () => {
		expect(() => parseStandardsArgs("--rule a --folder b")).toThrow(
			StandardsArgumentError,
		);
	});
});
