import { keyText, type Theme } from "@earendil-works/pi-coding-agent";

/**
 * Render one keybinding hint with the theme the component was given.
 *
 * pi's own `keyHint` styles with pi's process-global theme, which a component
 * cannot rely on: the theme may change, and nothing guarantees the global is
 * initialized. Taking the theme as an argument keeps a component's colors on
 * the theme the TUI passed it and makes the component testable.
 */
export function keyHint(
	theme: Theme,
	keybinding: Parameters<typeof keyText>[0],
	description: string,
): string {
	return `${theme.fg("dim", keyText(keybinding))}${theme.fg("muted", ` ${description}`)}`;
}
