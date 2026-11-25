/**
 * The macOS half of `crust:testing`: one promise per evaluation, settled by WebKit's block.
 *
 * `-evaluateJavaScript:completionHandler:` takes a block, which may not cross `bun:ffi`, so
 * `testing-eval.c` builds one block per call and reports its answer through a `JSCallback`. The
 * answer arrives on the main run loop — the one crust's pump drives — and carries the request id,
 * so a completion that arrives after its own command timed out is dropped instead of settling the
 * next command. Commands are chained per window, so a hung evaluation on A cannot hold up B.
 *
 * Nothing here activates an app, moves a window or sends an event: the whole surface is a script in
 * a page the app already owns.
 */

import { cc, FFIType, JSCallback, ptr, toArrayBuffer } from "bun:ffi";
import { materialiseNativeSource } from "@/native-source.ts";

import type { WebviewFor } from "@/platform/darwin/webview-target";
import { CrustError } from "../bridge/errors";
import { createEvalQueue, createLabeledQueue, type EvalQueue } from "./testing-eval-queue.ts";
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
	crust_testing_eval: (
		web: number,
		bytes: number,
		length: number | bigint,
		id: number | bigint,
	) => number;
}

let library: TestingNative | undefined;

/** Compile once per process from a private per-user cache, never a planted /tmp path. */
function native(): TestingNative {
	if (library) return library;
	const path = materialiseNativeSource("crust-testing", source);
	library = cc({
		source: path,
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			crust_testing_available: { args: [P], returns: I32 },
			crust_testing_set_sink: { args: [P], returns: FFIType.void },
			crust_testing_eval: { args: [P, P, I64, I64], returns: I32 },
		},
	}).symbols as unknown as TestingNative;
	return library;
}

let sink: JSCallback | undefined;
let evaluations: EvalQueue | undefined;
const labeled = createLabeledQueue();

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** Record the one sink, on the first evaluation. C keeps a single function pointer. */
function channel(table: TestingNative, queue: EvalQueue): void {
	if (sink !== undefined) return;
	sink = new JSCallback(
		(kind: number, bytes: number, length: number | bigint, id: number | bigint) => {
			const size = Number(length);
			const text =
				size > 0
					? new TextDecoder().decode(new Uint8Array(toArrayBuffer(bytes, 0, size)))
					: "";
			queue.deliver(Number(id), Number(kind), text);
			return 0;
		},
		{ args: [I32, P, I64, I64], returns: I32 },
	);
	table.crust_testing_set_sink(callbackPointer(sink));
}

/** The correlator is per process, because the native sink is; the table is the compiled unit. */
function queueFor(table: TestingNative): EvalQueue {
	if (evaluations === undefined) {
		evaluations = createEvalQueue({
			send: (id, target, bytes) =>
				table.crust_testing_eval(target, ptr(bytes), BigInt(bytes.length), BigInt(id)),
			timeoutMs: EVAL_TIMEOUT_MS,
		});
	}
	return evaluations;
}

/**
 * Build the adapter over a window resolver. `web` is the same `WebviewFor` navigation and find use,
 * so a label that names no open window is refused by that resolver, raised here as
 * `unknown-window` — the code every command speaks.
 */
export function darwinTestingAdapter(
	web: WebviewFor,
	table: TestingNative = native(),
): TestingAdapter {
	const queue = queueFor(table);
	channel(table, queue);
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
			return labeled.run(label, () => queue.run(view as number, script));
		},
	};
}
