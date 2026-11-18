/**
 * Poll a condition up to a deadline. A fixed `Bun.sleep(n)` followed by an assertion is a flake: on
 * a loaded runner the event can land after `n`, and the assertion reads a half-finished world. A
 * deadline wait returns the moment the condition holds, and reports the label when it never does.
 *
 * Return `null`/`undefined`/`false` while the condition is false. A truthy value is returned as-is,
 * so a probe can hand back the array or object the assertions need.
 */
export const WAIT_POLL_MS = 10;

export async function waitFor<T>(
	probe: () => T | null | undefined | false,
	timeoutMs = 2000,
	label = "condition",
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = probe();
		if (value !== null && value !== undefined && value !== false) return value;
		if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
		await Bun.sleep(WAIT_POLL_MS);
	}
}
