/**
 * The adapter-side half of the `onNavigate` contract. Each browser surface owns a decision callback
 * handed in by the plugin; the one process-wide JSCallback the navigation shim calls looks the
 * surface up by its webview pointer, reads the action's URL from C and answers allow or cancel. The
 * same decision is consulted for an explicit `navigate`, and for the `target=_blank` handoff — a
 * refused popup is never passed to the system opener.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";
import { readText, type NavigationNative } from "./navigation-unit.ts";

const I32 = FFIType.i32;
const P = FFIType.ptr;

type Decision = (url: string) => boolean;

const decisions = new Map<number, Decision>();
let sink: JSCallback | undefined;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** Register a surface's decision, or pass undefined when it closes. */
export function decideFor(web: number, decision?: Decision): void {
	if (decision === undefined) decisions.delete(web);
	else decisions.set(web, decision);
}

/**
 * The synchronous call a commit makes from JS. Absent decision means allow: app windows and
 * surfaces whose app did not configure an origin gate keep their old behaviour.
 */
export function askDecision(web: number, url: string): boolean {
	const decision = decisions.get(web);
	return decision === undefined || decision(url) !== false;
}

/** Install the one sink C calls for every committed navigation. */
export function installDecisionSink(native: NavigationNative): void {
	if (sink === undefined) {
		sink = new JSCallback(
			(web: number) => {
				const url = readText((into) =>
					Number(native.crust_nav_decision_url(ptr(into), into.length) ?? -1),
				);
				try {
					return askDecision(Number(web), url) ? 1 : 0;
				} catch {
					// A throwing page callback must not unwind into WebKit's delegate call.
					return 0;
				}
			},
			{ args: [P], returns: I32 },
		);
	}
	native.crust_nav_set_decision_sink(callbackPointer(sink));
}
