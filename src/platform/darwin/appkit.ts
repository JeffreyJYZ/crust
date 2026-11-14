/**
 * Bringing NSApplication up, in the measured order: compile the shim, preflight every selector, then `NSApplicationLoad` → `sharedApplication` → policy. The caller owns the pump and the run-loop mode, so this returns the app object alone.
 */
import { shim } from "./index.ts";
import { cls, S } from "./objc.ts";
import { PREFLIGHT, preflightError } from "./preflight.ts";

export function startAppKit(appName: string): number {
	const failures: string[] = [];
	for (const entry of PREFLIGHT) {
		const error = preflightError(entry);
		if (error) failures.push(error);
	}
	if (failures.length > 0) {
		throw new Error(`${appName}: selector preflight failed:\n  ${failures.join("\n  ")}`);
	}

	const loaded = Number(shim().symbols.shim_app_load() ?? 0);
	if (!loaded) throw new Error("NSApplicationLoad returned false");

	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	if (!app) throw new Error("+[NSApplication sharedApplication] returned null");
	S.vq1(app, "setActivationPolicy:", 0);
	// A real app finishes launching before it runs; without this the process sits
	// half-launched, macOS never considers it properly running, and WebKit drops the
	// window layer a few seconds in while the page keeps executing.
	try {
		S.v0(app, "finishLaunching");
	} catch {
		// Older systems may refuse before the run loop starts; nothing else depends on it.
	}
	return app;
}
