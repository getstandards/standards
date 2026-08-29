import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { formatElapsed, ReviewProgressPanel } from "./progress-panel.js";
import type { ReviewProgress } from "./standards-review.js";

/** A TUI stub that records render requests and mounts nothing. */
function fakeTui(): {
	tui: TUI;
	renderRequests: { count: number };
} {
	const renderRequests = { count: 0 };
	const tui = {
		requestRender() {
			renderRequests.count += 1;
		},
		renderNow() {},
		invalidate() {},
		setFocus() {},
		addChild() {},
		removeChild() {},
		clear() {},
		render() {
			return [];
		},
	} as unknown as TUI;
	return { tui, renderRequests };
}

/** A real Theme with every color set, so rendering exercises the ANSI path. */
function testTheme(): Theme {
	const fgColors = {
		accent: "#ff5fff",
		border: "#4a4a4a",
		borderAccent: "#ff5fff",
		borderMuted: "#3a3a3a",
		success: "#2dd4bf",
		error: "#f87171",
		warning: "#fbbf24",
		muted: "#9ca3af",
		dim: "#6b7280",
		text: "#e5e7eb",
		thinkingText: "#9ca3af",
		searchMatchText: "#000000",
		userMessageText: "#e5e7eb",
		customMessageText: "#e5e7eb",
		customMessageLabel: "#ff5fff",
		toolTitle: "#e5e7eb",
		toolOutput: "#d1d5db",
		mdHeading: "#e5e7eb",
		mdLink: "#60a5fa",
		mdLinkUrl: "#9ca3af",
		mdCode: "#f472b6",
		mdCodeBlock: "#d1d5db",
		mdCodeBlockBorder: "#3a3a3a",
		mdQuote: "#9ca3af",
		mdQuoteBorder: "#3a3a3a",
		mdHr: "#3a3a3a",
		mdListBullet: "#9ca3af",
		toolDiffAdded: "#2dd4bf",
		toolDiffRemoved: "#f87171",
		toolDiffContext: "#9ca3af",
		syntaxComment: "#6b7280",
		syntaxKeyword: "#c084fc",
		syntaxFunction: "#60a5fa",
		syntaxVariable: "#e5e7eb",
		syntaxString: "#2dd4bf",
		syntaxNumber: "#fbbf24",
		syntaxType: "#f472b6",
		syntaxOperator: "#e5e7eb",
		syntaxPunctuation: "#9ca3af",
		thinkingOff: "#9ca3af",
		thinkingMinimal: "#9ca3af",
		thinkingLow: "#9ca3af",
		thinkingMedium: "#9ca3af",
		thinkingHigh: "#9ca3af",
		thinkingXhigh: "#9ca3af",
		thinkingMax: "#ff5fff",
		bashMode: "#2dd4bf",
	} satisfies Record<ThemeColor, string>;
	const bgColors = {
		selectedBg: "#1f2937",
		scrollbarThumb: "#3a3a3a",
		searchMatchBg: "#fbbf24",
		userMessageBg: "#1f2937",
		customMessageBg: "#1f2937",
		toolPendingBg: "#1f2937",
		toolSuccessBg: "#1f2937",
		toolErrorBg: "#1f2937",
	} satisfies ConstructorParameters<typeof Theme>[1];
	return new Theme(fgColors, bgColors, "truecolor");
}

/** Assert that no rendered line is wider than the viewport. */
function expectWithinWidth(lines: string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
}

describe("ReviewProgressPanel", () => {
	it("renders the phase, the elapsed time, and the cancel hint", () => {
		const { tui } = fakeTui();
		const panel = new ReviewProgressPanel(tui, testTheme());
		try {
			const lines = panel.render(80);
			expect(lines.join("\n")).toContain("Standards review");
			expect(lines.join("\n")).toContain("cancel");
			expectWithinWidth(lines, 80);
		} finally {
			panel.dispose();
		}
	});

	it("shows the detail of a resolving or planning phase", () => {
		const { tui } = fakeTui();
		const panel = new ReviewProgressPanel(tui, testTheme());
		try {
			panel.update({ phase: "planning", detail: "Preparing the review plan" });
			const lines = panel.render(80);
			expect(lines.join("\n")).toContain("planning");
			expect(lines.join("\n")).toContain("Preparing the review plan");
			expectWithinWidth(lines, 80);
		} finally {
			panel.dispose();
		}
	});

	it("shows a proportional bar and counts for an evaluation phase", () => {
		const { tui } = fakeTui();
		const panel = new ReviewProgressPanel(tui, testTheme());
		try {
			panel.update({ phase: "evaluation", completed: 2, total: 4 });
			const lines = panel.render(80);
			expect(lines.join("\n")).toContain("evaluating");
			expect(lines.join("\n")).toContain("2/4");
			expectWithinWidth(lines, 80);
		} finally {
			panel.dispose();
		}
	});

	it("aborts its signal and calls onAbort when the reader cancels", () => {
		const { tui } = fakeTui();
		const panel = new ReviewProgressPanel(tui, testTheme());
		let aborted = false;
		panel.onAbort = () => {
			aborted = true;
		};
		try {
			expect(panel.signal.aborted).toBe(false);
			panel.handleInput("\u001b");
			expect(panel.signal.aborted).toBe(true);
			expect(aborted).toBe(true);
		} finally {
			panel.dispose();
		}
	});

	it("keeps rendering after progress updates without a crash", () => {
		const { tui } = fakeTui();
		const panel = new ReviewProgressPanel(tui, testTheme());
		try {
			const phases: ReviewProgress[] = [
				{ phase: "resolving", detail: "Reading .standards.yml" },
				{ phase: "planning", detail: "Planning the evaluation" },
				{ phase: "evaluation", completed: 1, total: 3 },
				{ phase: "verification", completed: 3, total: 3 },
			];
			for (const phase of phases) {
				panel.update(phase);
				expectWithinWidth(panel.render(100), 100);
			}
		} finally {
			panel.dispose();
		}
	});
});

describe("formatElapsed", () => {
	it("formats durations as minutes and seconds", () => {
		expect(formatElapsed(0)).toBe("0:00");
		expect(formatElapsed(1_005)).toBe("0:01");
		expect(formatElapsed(65_000)).toBe("1:05");
		expect(formatElapsed(3_600_000)).toBe("60:00");
	});
});
