/**
 * The macOS half of `crust:findinpage`: the promise, the request id and the adapter.
 * `-findString:withConfiguration:completionHandler:` takes a block, which may not cross
 * `bun:ffi`, so `shim/108_find.c` builds a GLOBAL block and reports the request id plus the one BOOL
 * it carries through a `JSCallback`. The answer therefore arrives later than the send, and every
 * command here is a promise settled by that callback. A second search fails the older promise but
 * cannot cancel the older WebKit find, so the id is what stops a stale completion from answering
 * the newer search.
 * `WKFindConfiguration` has no `findNext`/`findPrevious`: advancing repeats the last search with
 * `backwards` flipped. The text is kept **per webview** here, so two windows cannot overwrite each
 * other's query the way C's one process-wide `find_last` did.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";
import type { FindAdapter, FindOutcome } from "@/plugins/findinpage";
import { FIND_STATUS, findStartReason, findUnit, type FindNative } from "./find-unit";
import type { LabeledAdapter, WebviewFor } from "./webview-target.ts";

export { FIND_STATUS, findStartReason, findUnit };
export type { FindNative, FindUnit } from "./find-unit";

const I32 = FFIType.i32;

/**
 * How long a search may stay unanswered. WebKit calls the completion handler on the main
 * thread, which crust's pump drives; a promise that outlives this is reported rather than left
 * hanging, because a page awaiting it would never learn anything.
 */
export const FIND_TIMEOUT_MS = 4000;

/** One sink per process: C keeps a single function pointer, so a second JSCallback is never reached. */
let sink: JSCallback | undefined;
interface Pending {
	id: number;
	settle: (outcome: FindOutcome) => void;
	fail: (error: Error) => void;
}
let pending: Pending | undefined;
let generation = 0;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** The sink body, exported so a suite can deliver a completion without a live WebKit. */
export function deliverFind(id: number, found: number): void {
	// A completion from a superseded search must never settle the newer promise.
	if (id !== pending?.id) return;
	const answer = pending;
	pending = undefined;
	// WKFindResult carries no count, so the one BOOL is both the answer and the only number this
	// can report honestly.
	const hit = Number(found) === 1;
	answer.settle({ matches: hit ? 1 : 0, found: hit });
}

function channel(native: FindNative): void {
	if (sink === undefined) {
		sink = new JSCallback(
			(id: number, found: number) => {
				deliverFind(id, found);
				return 0;
			},
			{ args: [I32, I32], returns: I32 },
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
function ask(native: FindNative, id: number, start: () => number): Promise<FindOutcome> {
	supersede();
	return new Promise<FindOutcome>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		pending = {
			id,
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
	/** Each window's own last query; a repeat never reads another window's text. */
	const last = new Map<number, { text: string; matchCase: boolean }>();

	const run = (
		view: number,
		text: string,
		matchCase: boolean,
		backwards: boolean,
	): Promise<FindOutcome> => {
		channel(native);
		const bytes = new TextEncoder().encode(text);
		const id = ++generation;
		return ask(native, id, () =>
			Number(
				native.crust_find_search(
					view,
					ptr(bytes),
					bytes.length,
					backwards ? 1 : 0,
					matchCase ? 1 : 0,
					id,
				) ?? FIND_STATUS.unavailable,
			),
		);
	};

	return {
		search: (query, label?) => {
			const view = target(label);
			last.set(view, { text: query.text, matchCase: query.matchCase });
			return run(view, query.text, query.matchCase, !query.forward);
		},
		next: (label?) => {
			const view = target(label);
			const query = last.get(view);
			if (query === undefined) {
				throw new Error("crust: findinpage.next needs a search in this window first");
			}
			return run(view, query.text, query.matchCase, false);
		},
		previous: (label?) => {
			const view = target(label);
			const query = last.get(view);
			if (query === undefined) {
				throw new Error("crust: findinpage.previous needs a search in this window first");
			}
			return run(view, query.text, query.matchCase, true);
		},
	};
}
