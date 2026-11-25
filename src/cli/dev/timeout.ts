/**
 * The readiness-failure sentence. Kept pure so the wording can be tested without waiting 30 s
 * on a socket that never listens.
 */

/**
 * `beforeDevCommand` is optional: an already-running external server has no "before" line and no
 * child output. Naming its output in that case sends the user looking for text never printed.
 */
export function devTimeoutMessage(devUrl: string, beforeDevCommand?: string): string {
	const hint = beforeDevCommand
		? "Check the beforeDevCommand output above"
		: `No beforeDevCommand is configured for ${devUrl} — start that server yourself`;
	return (
		`${devUrl} did not accept a connection within 30 s — the window loads it once and ` +
		`cannot retry, so nothing would render. ${hint}`
	);
}
