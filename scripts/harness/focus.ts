/**
 * Hand focus back to the human's terminal after a probe that launched or activated a GUI app. Every crust launch activates its app — AppKit only lists windows on the active Space, so the app has to be active to be in the accessibility tree — which means a harness that stops at its verdict leaves the person staring at a test window.
 * A courtesy, never an assertion: Ghostty may be absent, so `open` is best-effort and its failure is swallowed. Safe to call when no window was ever shown.
 */

/** The terminal the gates are run from on this machine. */
const TERMINAL = "Ghostty";

/** Activate the terminal, or do nothing at all. Never throws, never fails a run. */
export async function restoreFocus(): Promise<void> {
	// `open` is macOS's alone; a Linux or Windows runner has no Ghostty to hand focus to.
	if (process.platform !== "darwin") return;
	try {
		const child = Bun.spawn(["open", "-a", TERMINAL], {
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
		});
		await child.exited;
	} catch {
		// No Ghostty installed, no `open`, or no window server: the courtesy is unavailable.
	}
}
