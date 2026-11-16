/**
 * The one step `scripts/linux-smoke.ts` cannot take: `Platform.quit()` on real GTK. The smoke stops
 * its own pump and returns, so nothing there proves that `quit()` — `stopPump()` plus the backend's
 * `process.exit(0)` — actually ends the process. This file is that proof and nothing else, which is
 * why it is a separate entry point: once `quit()` works there is no process left to assert in.
 *
 * The proof is the exit code the driver reads. A working `quit()` ends the process with 0 before the
 * line after it runs; a `quit()` that merely returns leaves the armed pump holding the event loop
 * open, so either the NOT TAKEN line and exit 3 appear, or the driver's deadline reports 124.
 */
import type { CrustConfig } from "@/config";
import { createPlatform } from "@/platform/linux";

/** GTK reads nothing from the config before a window exists; the smoke's window carries its own URL. */
const CONFIG: CrustConfig = {
	app: { id: "dev.crust.quit", name: "crust quit smoke", version: "0.0.0" },
	windows: [],
};

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
	const platform = createPlatform(CONFIG);
	await platform.start();
	platform.createWindow({
		label: "quit",
		title: "crust quit smoke",
		width: 320,
		height: 240,
		url: "about:blank",
	});
	platform.pump(16);
	await Bun.sleep(60);

	console.log(
		`linux-gtk: quit — window "quit" open, pump at ${platform.ticks} slices, calling quit()`,
	);
	// A piped stdout needs one tick to drain before `quit()` closes it from inside the platform.
	await Bun.sleep(20);
	platform.quit();

	console.log("linux-gtk: quit: NOT TAKEN — quit() returned instead of ending the process");
	process.exit(3);
}

try {
	await main();
} catch (error) {
	console.log(`linux-gtk: quit: FAIL — ${message(error)}`);
	process.exit(1);
}
