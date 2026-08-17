/** Return the message from a thrown value. */
export function errorMessage<Thrown>(thrown: Thrown): string {
	return thrown instanceof Error ? thrown.message : String(thrown);
}

/** Return true when a thrown value reports a missing file. */
export function isMissingFileError<Thrown>(thrown: Thrown): boolean {
	return (
		typeof thrown === "object" &&
		thrown !== null &&
		"code" in thrown &&
		thrown.code === "ENOENT"
	);
}
