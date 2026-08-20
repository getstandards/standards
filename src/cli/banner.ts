import chalk from "chalk";
import { VERSION } from "./version.js";

/**
 * The Standards wordmark, drawn with box-drawing characters.
 *
 * It renders only in the root help text, a purely human-facing surface. Other
 * command output never includes it, so machine-readable output stays clean.
 */
const STANDARDS_LOGO = [
	"  ███████╗████████╗ █████╗ ███╗   ██╗██████╗  █████╗ ██████╗ ██████╗ ███████╗",
	"  ██╔════╝╚══██╔══╝██╔══██╗████╗  ██║██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔════╝",
	"  ███████╗   ██║   ███████║██╔██╗ ██║██║  ██║███████║██████╔╝██║  ██║███████╗",
	"  ╚════██║   ██║   ██╔══██║██║╚██╗██║██║  ██║██╔══██║██╔══██╗██║  ██║╚════██║",
	"  ███████║   ██║   ██║  ██║██║ ╚████║██████╔╝██║  ██║██║  ██║██████╔╝███████║",
	"  ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝",
] as const;

/**
 * Render the root help banner: the Standards logo and the current version.
 *
 * Color is applied through `chalk`, which renders plain text when standard
 * output is not a terminal, so redirects and test capture stay uncolored.
 */
export function renderBanner(): string {
	const logo = chalk.cyan(STANDARDS_LOGO.join("\n"));
	return `${logo}\n\n  ${chalk.bold(`Standards ${VERSION}`)}\n`;
}
