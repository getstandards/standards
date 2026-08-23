// Generate standards-review-{dark,light}.svg for the README: a rendering of
// `standards review --base main --verbose` terminal output, styled like
// src/cli/commands/review-report-text.ts (terminal) and review-verbose.ts.
// Run with: node assets/generate-review-screenshot.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = dirname(fileURLToPath(import.meta.url));

// Segment styles: d=default, m=dim, r=red, y=yellow, c=cyan, b=bold default
const L = (...segs) => segs;
const s = (style, text) => ({ style, text });

const lines = [
	L(s("m", "$ "), s("d", "standards review --base main --verbose")),
	L(s("m", "› "), s("m", "Base revision:"), s("d", " 40c7741950173b8344ab825f49dcb50b7fa02d07")),
	L(s("m", "› "), s("m", "Head revision:"), s("d", " 95751e9e27dd86eecdc08fdff2bf6dc3180eb09e")),
	L(s("m", "› "), s("m", "Selected src/api/orders.ts (added):"), s("d", " money.no-floating-point, api.paginate-unbounded-collections")),
	L(s("m", "› "), s("m", "Selected src/billing/refund.ts (modified):"), s("d", " money.no-floating-point")),
	L(s("m", "› "), s("m", "Evaluation task 1/2:"), s("d", " src/api/orders.ts (rules: money.no-floating-point, api.paginate-unbounded-collections)")),
	L(s("m", "› "), s("m", "Evaluation task 2/2:"), s("d", " src/billing/refund.ts (rules: money.no-floating-point)")),
	L(s("d", "Evaluating 2 selected files in 2 evaluation tasks.")),
	L(s("m", "› "), s("m", "Evaluating task 1/2:"), s("d", " src/api/orders.ts.")),
	L(s("m", "› "), s("m", "Evaluating task 2/2:"), s("d", " src/billing/refund.ts.")),
	L(s("m", "› "), s("m", "Verifying finding 1/2:"), s("d", " api.paginate-unbounded-collections at src/api/orders.ts:14-14.")),
	L(s("m", "› "), s("m", "Verifying finding 2/2:"), s("d", " money.no-floating-point at src/billing/refund.ts:41-41.")),
	L(s("r", "✘"), s("b", " Standards review: non-compliant")),
	L(),
	L(s("m", "  Evaluation model:    "), s("d", "anthropic/claude-sonnet-5")),
	L(s("m", "  Verification model:  "), s("d", "anthropic/claude-sonnet-5")),
	L(s("m", "  Resolved rules:      "), s("c", "2")),
	L(s("m", "  Selected rules:      "), s("c", "2")),
	L(s("m", "  Evaluation tasks:    "), s("c", "2")),
	L(s("m", "  Findings:            "), s("r", "MUST NOT: 1"), s("d", ", "), s("y", "SHOULD: 1")),
	L(s("m", "  Evaluation usage:    "), s("m", "2 invocations, 4980 input tokens, 507 output tokens")),
	L(s("m", "  Verification usage:  "), s("m", "2 invocations, 3675 input tokens, 348 output tokens")),
	L(),
	L(s("b", "Findings")),
	L(),
	L(s("d", "  "), s("y", "⚠"), s("d", " "), s("b", "src/api/orders.ts:14"), s("d", "  "), s("c", "api.paginate-unbounded-collections"), s("d", " "), s("y", "(SHOULD)")),
	L(s("d", "    "), s("m", "Evidence:"), s("d", '   router.get("/orders", async (_, res) => res.json(await orders.findAll()));')),
	L(s("d", "    "), s("m", "Reason:"), s("d", "     The endpoint returns every order in one response and accepts no pagination parameters.")),
	L(s("d", "    "), s("m", "Guidance:"), s("d", "   Accept limit and cursor parameters and cap the page size.")),
	L(),
	L(s("d", "  "), s("r", "✘"), s("d", " "), s("b", "src/billing/refund.ts:41"), s("d", "  "), s("c", "money.no-floating-point"), s("d", " "), s("r", "(MUST NOT)")),
	L(s("d", "    "), s("m", "Evidence:"), s("d", "   const refund = order.total * 0.15;")),
	L(s("d", "    "), s("m", "Reason:"), s("d", "     The refund amount is computed with floating-point arithmetic on a monetary value.")),
	L(s("d", "    "), s("m", "Guidance:"), s("d", "   Use the Money value object, or an integer in the smallest currency unit.")),
];

const themes = {
	dark: {
		bg: "#161b22", border: "#30363d", headerBg: "#21262d", title: "#7d8590",
		d: "#e6edf3", m: "#7d8590", r: "#ff7b72", y: "#d29922", c: "#39c5cf", b: "#e6edf3",
	},
	light: {
		bg: "#ffffff", border: "#d0d7de", headerBg: "#f6f8fa", title: "#6e7781",
		d: "#1f2328", m: "#6e7781", r: "#cf222e", y: "#9a6700", c: "#1b7c83", b: "#1f2328",
	},
};

const escape = (text) =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const WIDTH = 880;
const FONT_SIZE = 12;
const LINE_HEIGHT = 18;
const PAD_X = 20;
const TEXT_TOP = 66;
const HEIGHT = TEXT_TOP + lines.length * LINE_HEIGHT + 4;

function render(name, t) {
	const out = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT_SIZE}">`);
	out.push(`  <title>standards review terminal output: a non-compliant report with two findings</title>`);
	out.push(`  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="9" fill="${t.bg}" stroke="${t.border}"/>`);
	out.push(`  <path d="M0.5 9.5a9 9 0 0 1 9-9h${WIDTH - 19}a9 9 0 0 1 9 9v26.5h-${WIDTH - 1}z" fill="${t.headerBg}"/>`);
	out.push(`  <line x1="0.5" y1="36" x2="${WIDTH - 0.5}" y2="36" stroke="${t.border}"/>`);
	out.push(`  <circle cx="22" cy="18.5" r="5.5" fill="#ff5f57"/>`);
	out.push(`  <circle cx="40" cy="18.5" r="5.5" fill="#febc2e"/>`);
	out.push(`  <circle cx="58" cy="18.5" r="5.5" fill="#28c840"/>`);
	out.push(`  <text x="${WIDTH / 2}" y="22.5" text-anchor="middle" fill="${t.title}">standards review</text>`);
	lines.forEach((segs, index) => {
		if (segs.length === 0) return;
		const y = TEXT_TOP + index * LINE_HEIGHT;
		const tspans = segs
			.map(({ style, text }) => {
				const weight = style === "b" ? ` font-weight="600"` : "";
				return `<tspan fill="${t[style]}"${weight}>${escape(text)}</tspan>`;
			})
			.join("");
		out.push(`  <text x="${PAD_X}" y="${y}" xml:space="preserve">${tspans}</text>`);
	});
	out.push(`</svg>`);
	writeFileSync(join(assetsDir, `standards-review-${name}.svg`), `${out.join("\n")}\n`);
}

for (const [name, theme] of Object.entries(themes)) render(name, theme);
console.log(`wrote 2 SVGs, ${lines.length} lines, ${WIDTH}x${HEIGHT}`);
