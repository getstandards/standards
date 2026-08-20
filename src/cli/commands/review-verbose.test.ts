import figures from "figures";
import { describe, expect, it } from "vitest";
import { renderVerboseLineTerminal } from "./review-verbose.js";

// chalk renders plain text when standard error is not a terminal, so the
// tests assert the glyph and the preserved text, not escape codes.
describe("renderVerboseLineTerminal", () => {
	it("keeps the label and detail behind a pointer glyph", () => {
		const rendered = renderVerboseLineTerminal("Base revision: abc123");

		expect(rendered).toBe(`${figures.pointerSmall} Base revision: abc123`);
	});

	it("keeps a dropped-finding line intact", () => {
		const rendered = renderVerboseLineTerminal(
			"Rejected finding: money.no-float at src/invoice.ts:41-44.",
		);

		expect(rendered).toBe(
			`${figures.pointerSmall} Rejected finding: money.no-float at src/invoice.ts:41-44.`,
		);
	});

	it("renders a line without a label as one dim line", () => {
		const rendered = renderVerboseLineTerminal("Review complete.");

		expect(rendered).toBe(`${figures.pointerSmall} Review complete.`);
	});
});
