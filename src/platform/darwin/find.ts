/**
 * The macOS half of `crust:findinpage`: the promise, the timeout and the adapter.
 * `-findString:withConfiguration:completionHandler:` takes a block, which may not cross
 * `bun:ffi`, so `shim/108_find.c` builds a GLOBAL block and reports the one BOOL it carries
 * through a `JSCallback`. The answer therefore arrives later than the send, and every command
 * here is a promise settled by that callback.
 * `WKFindConfiguration` has no `findNext`/`findPrevious`: advancing repeats the last search
 * with `backwards` flipped, which is what `next()` and `previous()` do.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";
import type { FindAdapter, FindOutcome } from "@/plugins/findinpage";
import { FIND_STATUS, findStartReason, findUnit, type FindNative } from "./find-unit";
import type { LabeledAdapter, WebviewFor } from "./webview-target.ts";

export { FIND_STATUS, findStartReason, findUnit };
export type { FindNative, FindUnit } from "./find-unit";

const P = FFIType.ptr;
const I32 = FFIType.i32;

/**
 * How long a search may stay unanswered. WebKit calls the completion handler on the main
 * thread, which crust's pump drives; a promise that outlives this is reported rather than left
 * hanging, because a page awaiting it would never learn anything.
 */
export const FIND_TIMEOUT_MS = 4000;

/** One sink per process: C keeps a single function pointer, so a second JSCallback is never reached. */
let sink: JSCallback | undefined;
let pending: { settle: (outcome: FindOutcome) => void; fail: (error: Error) => void } | undefined;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

function channel(native: FindNative): void {
	if (sink === undefined) {
		sink = new JSCallback(
			(found: number) => {
				const answer = pending;
				pending = undefined;
				// WKFindResult carries no count, so the one BOOL is both the answer and the only
				// number this can report honestly.
				const hit = Number(found) === 1;
				answer?.settle({ matches: hit ? 1 : 0, found: hit });
				return 0;
			},
			{ args: [I32], returns: I32 },
		);
	}
	native.crust_find_set_sink(callbackPointer(sink));
}

/** A search that was already running cannot answer for the next one. */
function supersede(): void {
	const previous = pending;
	pending = undefined;
	previous?.fail(new Error("crust: a second find superseded this one before WebKit answered"));
}

/**
 * Start one search and await WebKit's completion. The pending resolver is installed before the
 * send, because a completion that arrived during `findString:` would otherwise be lost.
 */
function ask(native: FindNative, start: () => number): Promise<FindOutcome> {
	supersede();
	return new Promise<FindOutcome>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		pending = {
			settle: (outcome) => {
				done();
				resolve(outcome);
			},
			fail: (error) => {
				done();
				reject(error);
			},
		};
		const status = start();
		if (status !== FIND_STATUS.started) {
			done();
			pending = undefined;
			reject(new Error(`crust: find did not start: ${findStartReason(status)}`));
			return;
		}
		timer = setTimeout(() => {
			if (pending === undefined) return;
			pending = undefined;
			reject(
				new Error(
					`crust: the find completion handler did not answer within ${FIND_TIMEOUT_MS} ms`,
				),
			);
		}, FIND_TIMEOUT_MS);
	});
}

/**
 * Build the adapter. `web` resolves a window label to the WKWebView pointer, per call, because
 * a window created after this ran still has to be reachable and a multi-window app must search
 * the window a command names. No label is the app's first open window; an unknown label is the
 * resolver's `bad-request`, never a silent fall back to that first window.
 */
export function darwinFindAdapter(
	web: WebviewFor,
	native: FindNative = findUnit().symbols,
): LabeledAdapter<FindAdapter> {
	const target = (label?: string): number => {
		const pointer = web(label);
		if (pointer === null || pointer === 0) {
			throw new Error("crust: findinpage needs a WKWebView and this window has none");
		}
		return pointer;
	};
	/**
	 * The case flag the last search sent, per webview: a repeat re-runs that window's own
	 * search, so two windows cannot overwrite each other's flag.
	 */
	const matchCase = new Map<number, boolean>();

	return {
		search: (query, label?: string) => {
			const view = target(label);
			matchCase.set(view, query.matchCase);
			channel(native);
			const bytes = new TextEncoder().encode(query.text);
			return ask(native, () =>
				Number(
					native.crust_find_search(
						view,
						ptr(bytes),
						bytes.length,
						query.forward ? 0 : 1,
						query.matchCase ? 1 : 0,
					) ?? FIND_STATUS.unavailable,
				),
			);
		},
		next: (label?: string) => {
			const view = target(label);
			channel(native);
			return ask(native, () =>
				Number(
					native.crust_find_repeat(view, 0, matchCase.get(view) ? 1 : 0) ??
						FIND_STATUS.unavailable,
				),
			);
		},
		previous: (label?: string) => {
			const view = target(label);
			channel(native);
			return ask(native, () =>
				Number(
					native.crust_find_repeat(view, 1, matchCase.get(view) ? 1 : 0) ??
						FIND_STATUS.unavailable,
				),
			);
		},
	};
}
