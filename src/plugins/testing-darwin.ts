/**
 * The macOS half of `crust:testing`: one promise per evaluation, settled by WebKit's block.
 *
 * `-evaluateJavaScript:completionHandler:` takes a block, which may not cross `bun:ffi`, so
 * `testing-eval.c` builds a global block and reports its answer through a `JSCallback`. The answer
 * arrives on the main run loop — the one crust's pump drives — so this module keeps a single pending
 * evaluation and serialises calls: two commands in one window would otherwise settle each other's
 * promise, because the block carries no request id.
 *
 * Nothing here activates an app, moves a window or sends an event: the whole surface is a script in
 * a page the app already owns.
 */

import { cc, FFIType, JSCallback, ptr, toArrayBuffer } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WebviewFor } from "@/platform/darwin/webview-target";
import { CrustError } from "../bridge/errors";
import source from "./testing-eval.c" with { type: "text" };
import type { TestingAdapter } from "./testing-types";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;

/** How long one evaluation may stay unanswered before it is reported rather than left hanging. */
export const EVAL_TIMEOUT_MS = 4000;

/** The exported table, typed by hand: `cc()` hands back loose symbols. */
interface TestingNative {
	crust_testing_available: (web: number) => number;
	crust_testing_set_sink: (sink: number) => void;
	crust_testing_eval: (web: number, bytes: number, length: number | bigint) => number;
}

let library: TestingNative | undefined;

/** Compile the evaluate unit once per process, content-hashed so a second call reuses TinyCC's cache. */
function native(): TestingNative {
	if (library) return library;
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-testing-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, source);
	library = cc({
		source: path,
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			crust_testing_available: { args: [P], returns: I32 },
			crust_testing_set_sink: { args: [P], returns: FFIType.void },
			crust_testing_eval: { args: [P, P, I64], returns: I32 },
		},
	}).symbols as unknown as TestingNative;
	return library;
}

/** One answer from the block: kind 0 is a value, 1 an `NSError`, 2 a nil result. */
interface Pending {
	settle: (value: string) => void;
	fail: (error: Error) => void;
}

let pending: Pending | undefined;
let sink: JSCallback | undefined;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** Record the one sink, on the first evaluation. C keeps a single function pointer. */
function channel(table: TestingNative): void {
	if (sink !== undefined) return;
	sink = new JSCallback(
		(kind: number, bytes: number, length: number | bigint) => {
			const size = Number(length);
			const text =
				size > 0
					? new TextDecoder().decode(new Uint8Array(toArrayBuffer(bytes, 0, size)))
					: "";
			const answer = pending;
			pending = undefined;
			if (answer === undefined) return 0;
			if (Number(kind) === 0) answer.settle(text);
			else if (Number(kind) === 1) answer.fail(new Error(text || "crust: the page threw"));
			else answer.fail(new Error("crust: the page answered nothing"));
			return 0;
		},
		{ args: [I32, P, I64], returns: I32 },
	);
	table.crust_testing_set_sink(callbackPointer(sink));
}

/** Every script buffer stays reachable for the process lifetime: WebKit keeps the string, not our array. */
const buffers = new Set<Uint8Array>();

/** One evaluation, resolved when WebKit's block runs. The caller is serialised by `queue`. */
function evaluate(nativeTable: TestingNative, web: number, script: string): Promise<unknown> {
	channel(nativeTable);
	return new Promise<string>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		// Installed before the send: a completion that arrives during the send would otherwise be lost.
		pending = {
			settle: (value) => {
				done();
				resolve(value);
			},
			fail: (error) => {
				done();
				reject(error);
			},
		};
		const bytes = new TextEncoder().encode(script);
		const kept = new Uint8Array(bytes.length);
		kept.set(bytes);
		buffers.add(kept);
		const status = Number(nativeTable.crust_testing_eval(web, ptr(kept), BigInt(kept.length)));
		if (status !== 0) {
			pending = undefined;
			reject(new Error(`crust: evaluateJavaScript did not start (status ${status})`));
			return;
		}
		timer = setTimeout(() => {
			if (pending === undefined) return;
			pending = undefined;
			reject(new Error(`crust: the page did not answer within ${EVAL_TIMEOUT_MS} ms`));
		}, EVAL_TIMEOUT_MS);
		// An unanswered promise must not be the only thing keeping a quitting process alive.
		if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
	});
}

/** One evaluation at a time: the completion block carries no request id to correlate with. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Build the adapter over a window resolver. `web` is the same `WebviewFor` navigation and find use,
 * so a label that names no open window is refused by that resolver, raised here as
 * `unknown-window` — the code every command speaks.
 */
export function darwinTestingAdapter(
	web: WebviewFor,
	table: TestingNative = native(),
): TestingAdapter {
	return {
		evaluate: async (label: string | undefined, script: string) => {
			let view: number | null;
			try {
				view = web(label);
			} catch (error) {
				if (error instanceof CrustError && error.code === "bad-request") {
					throw Object.assign(new Error(error.message), { code: "unknown-window" });
				}
				throw error;
			}
			if (view === null || view === 0) {
				throw Object.assign(
					new Error("crust: testing needs a WKWebView and this window has none"),
					{ code: "unknown-window" },
				);
			}
			const next = queue.then(() => evaluate(table, view as number, script));
			queue = next.catch(() => undefined);
			return next;
		},
	};
}
