/**
 * Which window creations may bring the app forward, and the one selector that does it.
 *
 * AppKit lists only windows on the **active Space**, so a window whose app is not active is on
 * screen and absent from `AXWindows` — VoiceOver cannot see it. `-activateIgnoringOtherApps:` is what
 * lands for a directly-exec'd process, where `-activate` is silently refused. It is also the one
 * call that steals the front from another app, which is why `app.activate` exists.
 */
import type { ActivateMode } from "@/config";
import { S } from "./objc.ts";

export type { ActivateMode };

/** What one window creation is allowed to do about activation. */
export interface Activation {
	/** `app.activate` for this process. */
	mode: ActivateMode;
	/** The platform's `-activate`, at most once per process. */
	once: () => void;
}

/** The sends `raiseApp` needs, injected so a test can watch them without AppKit. */
export interface RaiseSends {
	sharedApp(): number;
	isActive(app: number): boolean;
	activateIgnoringOtherApps(app: number): void;
}

/**
 * Whether this process has already used its one `first` activation. Process-wide on purpose: `first`
 * means the first window of the launch, and a second `DarwinPlatform` in one process is still that
 * launch.
 */
let activatedOnce = false;

/** Whether `-activate` has been sent. Its own flag, because `window.focus` shares it with creates. */
let appActivated = false;

/** Test seam only: both flags are process-wide by design, so a test that wants a launch clears them. */
export function resetActivation(): void {
	activatedOnce = false;
	appActivated = false;
}

/**
 * `-activateIgnoringOtherApps:` when the app is not already active. Measured on a built bundle with
 * `lsappinfo info -only name $(lsappinfo front)`: a window created by the page at t8 pulled the app
 * to the front while the human was in another app.
 */
export function raiseApp(send: RaiseSends): void {
	try {
		const app = send.sharedApp();
		if (!app || send.isActive(app)) return;
		send.activateIgnoringOtherApps(app);
	} catch {
		// An older system without the pre-14 call keeps the window as it is.
	}
}

/**
 * One window create's activation.
 *
 * `always` raises on every create, guarded on the app not already being active. `first` raises only
 * on the first create of the process: `-isActive` is false whenever the human is in another app, so
 * a per-window `isActive` test activates on every window created from elsewhere and steals their
 * focus — measured, not assumed. `never` sends nothing at all.
 */
export function activateForWindow(mode: ActivateMode, once: () => void, send: RaiseSends): boolean {
	if (mode === "never") return false;
	if (mode === "first") {
		if (activatedOnce) return false;
		activatedOnce = true;
	}
	raiseApp(send);
	once();
	return true;
}

/**
 * `-activate`, then the deprecated fallback. macOS still refuses activation for a process
 * LaunchServices did not start — an unbundled `crust dev` logs `active no` — and a click on the
 * window activates it, so the refusal is not a dead end. Never throws.
 */
export function activateApp(app: number): void {
	if (!app) return;
	try {
		S.v0(app, "activate");
	} catch {
		try {
			S.vb1(app, "activateIgnoringOtherApps:", 1);
		} catch {
			// Activation is cosmetic; nothing depends on it.
		}
	}
}

/**
 * `-activate` at most once per process: every activation re-orders the app above whatever the user
 * was doing, so repeating it per window create or `window.focus` makes the Dock icon jump.
 */
export function activateAppOnce(app: number): void {
	if (appActivated) return;
	appActivated = true;
	activateApp(app);
}
