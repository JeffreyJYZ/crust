/**
 * One Windows `start()` attempt as data, so a thrown shim compile can be remembered and rethrown
 * on a retry. `startWindows` throws when the C unit will not build; the platform must not then look
 * started with no shim attached.
 */
import type { WindowsBackend, WindowsShim } from "./backend.ts";
import { startWindows } from "./startup.ts";

export interface WindowsStartResult {
	ok: boolean;
	shim?: WindowsShim;
	unavailable?: string;
	/** A thrown compile or setup failure, kept so a second start can report the real cause. */
	thrown?: unknown;
}

export function runWindowsStart(backend: WindowsBackend, appName: string): WindowsStartResult {
	try {
		const started = startWindows(backend, appName);
		return started.ok
			? { ok: true, shim: started.shim }
			: { ok: false, unavailable: started.unavailable };
	} catch (error) {
		return {
			ok: false,
			unavailable: error instanceof Error ? error.message : String(error),
			thrown: error,
		};
	}
}
