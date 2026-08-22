/**
 * A release date suffix on a model id: `-20251001` or `-2024-08-06`.
 *
 * Providers publish a dated id beside the moving alias that points at it, so
 * one model lineup produces several ids that mean the same model today.
 */
const DATED_MODEL_SUFFIX = /-\d{8}$|-\d{4}-\d{2}-\d{2}$/;

/**
 * Remove every model id that is another listed id plus a release date suffix.
 *
 * `claude-haiku-4-5-20251001` drops when `claude-haiku-4-5` is listed, because
 * the moving alias is the id a user should pass to `--model`. An id whose base
 * is not listed stays: it is the only way to reach that model.
 */
export function withoutDatedModelAliases(
	modelIds: readonly string[],
): string[] {
	const listed = new Set(modelIds);

	return modelIds.filter((modelId) => {
		const base = modelId.replace(DATED_MODEL_SUFFIX, "");
		return base === modelId || !listed.has(base);
	});
}
