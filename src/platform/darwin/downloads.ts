/**
 * The macOS half of `crust:downloads`: the adapter over the runtime `WKDownloadDelegate` the C unit
 * builds (`downloads-ffi.ts` compiles it, `shim/downloads/*.c` holds it).
 * **The seam.** WebKit wants two blocks, and a block cannot cross `bun:ffi`; the C side hand-builds
 * global blocks and the delegate's IMPs are one `JSCallback`. Every value this module reads back is
 * a C string, so no Objective-C object is ever held here.
 * **The destination.** WebKit asks for a path and waits, so the answer is chosen here — the
 * suggested name, made unique in the current directory — and written back through `dl_answer`.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import type { DownloadNativeEvent, DownloadsAdapter } from "@/plugins/downloads-types";
import { downloadsUnit, type DownloadsUnit } from "./downloads-ffi.ts";
import type { LabeledAdapter, WebviewFor } from "./webview-target.ts";

export { downloadsSource, downloadsUnit, type DownloadsUnit } from "./downloads-ffi.ts";

/** What the sink call carries: the C unit's `DL_ASK` and `DL_FINISHED`. */
const ASK = 0;
const FINISHED = 1;

// A strong reference for the duration of one send: bun:ffi reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

function pointerOf(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	if (typeof raw === "number") return raw;
	if (typeof raw === "bigint") return Number(raw);
	throw new Error("crust: JSCallback exposed no usable pointer");
}

/**
 * Paths this process already answered, so two downloads that start before either file exists cannot
 * both be told the same name. Never pruned: once WebKit writes one it is on disk anyway, and the set
 * holds a few dozen short strings at worst.
 */
const reserved = new Set<string>();

/**
 * A name WebKit may suggest, made unique in `directory`: the suggested stem with ` (n)` before its
 * extension, so a second download of the same file never replaces the first. `existsSync` alone is a
 * race — the delegate asks before any file is written — so every answer is reserved as well.
 */
export function uniquePath(directory: string, suggested: string): string {
	const cleaned = suggested.replace(/[/\\]/g, "_");
	const name = cleaned.length > 0 ? cleaned : "download";
	const extension = extname(name);
	const stem = extension.length > 0 ? name.slice(0, -extension.length) : name;
	for (let attempt = 0; attempt < 1000; attempt++) {
		const candidate = join(
			directory,
			attempt === 0 ? name : `${stem} (${attempt})${extension}`,
		);
		if (existsSync(candidate) || reserved.has(candidate)) continue;
		reserved.add(candidate);
		return candidate;
	}
	// A thousand names taken is a directory this process already filled; the clock is the escape.
	let fallback = join(directory, `${stem} (${Date.now()})${extension}`);
	for (let extra = 1; reserved.has(fallback); extra++) {
		fallback = join(directory, `${stem} (${Date.now()}) (${extra})${extension}`);
	}
	reserved.add(fallback);
	return fallback;
}

export interface DarwinDownloadsOptions {
	/**
	 * The WKWebView to download from, by window label. A resolver, because a window is created
	 * after the plugin; no label is the app's first open window.
	 */
	webview: WebviewFor;
}

/**
 * Build the adapter. `unit` is the compiled C unit, injectable so a test can prove which
 * webview a labelled command reached without compiling anything.
 */
export function darwinDownloadsAdapter(
	options: DarwinDownloadsOptions,
	unit: () => DownloadsUnit = downloadsUnit,
): LabeledAdapter<DownloadsAdapter> {
	const tokens = new Map<string, number>();
	const ids = new Map<number, string>();
	let directory = "";
	let sink: ((event: DownloadNativeEvent) => void) | undefined;
	// One trampoline for the process: the delegate class registers one IMP, so a second JSCallback
	// would never be reached.
	let channel: JSCallback | undefined;

	const ensure = (): JSCallback => {
		if (channel !== undefined) return channel;
		const compiled = unit();
		channel = new JSCallback(
			(rawToken: number | bigint, kind: number) => {
				const token = Number(rawToken);
				const text = String(compiled.symbols.dl_text_copy() ?? "");
				if (kind === ASK) {
					// The delegate is waiting on this answer: an empty one cancels the download.
					const { address, length } = bytesOf(uniquePath(directory, text));
					compiled.symbols.dl_answer(address, length);
					return;
				}
				const id = ids.get(token);
				ids.delete(token);
				compiled.symbols.dl_forget(token);
				if (id === undefined) return;
				tokens.delete(id);
				sink?.({ kind: kind === FINISHED ? "finished" : "failed", id, text });
			},
			{ args: [FFIType.i64, FFIType.i32], returns: FFIType.void },
		);
		return channel;
	};

	return {
		install(next, handler) {
			directory = next;
			sink = handler;
			const trampoline = ensure();
			if (!Number(unit().symbols.dl_install(pointerOf(trampoline)) ?? 0)) {
				throw new Error("crust: the WKDownloadDelegate could not be built");
			}
		},
		start(url, id, label?: string) {
			ensure();
			const web = options.webview(label);
			if (web === null) return false;
			const { address, length } = bytesOf(url);
			const token = Number(unit().symbols.dl_start(web, address, length) ?? 0);
			if (token <= 0) return false;
			tokens.set(id, token);
			ids.set(token, id);
			return true;
		},
		cancel(id) {
			const token = tokens.get(id);
			if (token === undefined) return false;
			tokens.delete(id);
			ids.delete(token);
			return Number(unit().symbols.dl_cancel(token) ?? 0) === 1;
		},
		progress(id) {
			const token = tokens.get(id);
			if (token === undefined) return -1;
			return Number(unit().symbols.dl_progress(token) ?? -1);
		},
		setDirectory(next) {
			directory = next;
		},
	};
}
