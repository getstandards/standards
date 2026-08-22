import type { AuthSubcommand } from "../cli-args.js";
import type { CommandContext } from "../cli-context.js";
import { renderAuthHelp } from "../cli-help.js";
import { runAuthStatusCommand } from "./auth-status.js";
import { runLoginCommand } from "./login.js";
import { runLogoutCommand } from "./logout.js";

/**
 * Run one credential subcommand of the `standards auth` command group.
 *
 * `auth` without a subcommand prints its help and exits with status `0`, so a
 * user who reaches for the group name learns the subcommands it holds.
 */
export async function runAuthCommand(
	context: CommandContext,
	subcommand: AuthSubcommand | undefined,
	provider: string | undefined,
): Promise<number> {
	if (subcommand === undefined) {
		context.output.log(renderAuthHelp());
		return 0;
	}

	switch (subcommand) {
		case "login":
			return runLoginCommand(context, provider);
		case "logout":
			return runLogoutCommand(context, provider);
		case "status":
			return runAuthStatusCommand(context);
	}
}
