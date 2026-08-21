import { chalkStderr } from "chalk";
import figures from "figures";

/** Verbose labels that report a dropped finding; they render as warnings. */
const DROPPED_FINDING_LABELS = [
	"Discarded duplicate finding",
	"Rejected finding",
];

/**
 * Render one verbose progress line for a human at an interactive terminal
 * (specs/cli.md review --verbose).
 *
 * Each line keeps its full text and gains a leading pointer glyph. The label
 * before the first ': ' renders dim, like the report's field labels; a
 * dropped-finding label renders yellow, like the report's warnings. Verbose
 * lines go to standard error, so colors come from `chalkStderr`, which
 * renders plain text when standard error is not a terminal. The calling
 * command uses this only on an interactive terminal; captured output keeps
 * the unstyled lines.
 */
export function renderVerboseLineTerminal(line: string): string {
	const pointer = chalkStderr.dim(figures.pointerSmall);
	const separator = line.indexOf(": ");
	if (separator === -1) {
		return `${pointer} ${chalkStderr.dim(line)}`;
	}
	const label = line.slice(0, separator);
	const detail = line.slice(separator + 2);
	const labelStyle = DROPPED_FINDING_LABELS.includes(label)
		? chalkStderr.yellow
		: chalkStderr.dim;
	return `${pointer} ${labelStyle(`${label}:`)} ${detail}`;
}
