/**
 * The compiled QuickLook unit: `shim/125_preview.c` (the C-side path array, the data source and its
 * items) joined with `shim/126_preview_panel.c` (the panel itself), compiled by `cc()` on the first
 * show with `-framework QuickLookUI`.
 * One unit, because the two halves share statics: the panel's IMPs answer from the array the first
 * half holds. `preview.ts` is the adapter on top; this file is only the boundary.
 * Nothing here shows a panel: `previewUnitStatus()` compiles and asks whether `QLPreviewPanel` is
 * reachable, which a machine without QuickLookUI answers honestly.
 */
import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C parts travel inside the binary as
// text and are materialised before `cc()` sees them — the device `opener.ts` uses. The order is the
// order the unit reads in: prelude and file list, the data source, the window's own close, the
// panel, then the proof hooks.
import listPart from "./shim/125_preview.c" with { type: "text" };
import dataPart from "./shim/126_preview_data.c" with { type: "text" };
import observerPart from "./shim/127_preview_observer.c" with { type: "text" };
import panelPart from "./shim/128_preview_panel.c" with { type: "text" };
import probePart from "./shim/129_preview_probe.c" with { type: "text" };

/** The unit's own source, in the only order that compiles. */
export const previewSource = [listPart, dataPart, observerPart, panelPart, probePart].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const F64 = FFIType.f64;
const CS = FFIType.cstring;

/** What `show` and `hide` report; mirrored by the C status macros. */
export const PREVIEW_STATUS = {
	ok: 0,
	unavailable: 1,
	noPaths: 2,
	refused: 3,
} as const;

/**
 * The native half as the adapter sees it, named so a test can drive the adapter with a fake.
 * Every method binds the unit when called, so nothing compiles at import time.
 */
export interface PreviewNative {
	available(): number;
	setPaths(text: string): number;
	owner(): number;
	show(owner: number, width: number, height: number): number;
	hide(): number;
	visible(): boolean;
	key(): boolean;
	windowNumber(): number;
	ownerLive(): number;
	reason(): string;
}

/** The exports, as `bun:ffi` hands them back. */
export interface PreviewUnit {
	symbols: {
		shim_preview_available: () => number;
		shim_preview_set_paths: (bytes: number, length: number) => number;
		shim_preview_count: () => number;
		shim_preview_path: (index: number) => string | null;
		shim_preview_show: (owner: number, width: number, height: number) => number;
		shim_preview_hide: () => number;
		shim_preview_visible: () => number;
		shim_preview_key: () => number;
		shim_preview_window_number: () => number;
		shim_preview_owner: () => number;
		shim_preview_owner_live: () => number;
		shim_preview_reason: () => string | null;
		shim_preview_probe_count: () => number;
		shim_preview_probe_item_url: (index: number) => string | null;
	};
}

function compile(): PreviewUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	const hash = createHash("sha256").update(previewSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-preview-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, previewSource);
	return cc({
		source: file,
		flags: ["-framework", "QuickLookUI", "-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			shim_preview_available: { args: [], returns: I32 },
			shim_preview_set_paths: { args: [P, I32], returns: I32 },
			shim_preview_count: { args: [], returns: I32 },
			shim_preview_path: { args: [I32], returns: CS },
			shim_preview_show: { args: [P, F64, F64], returns: I32 },
			shim_preview_hide: { args: [], returns: I32 },
			shim_preview_visible: { args: [], returns: I32 },
			shim_preview_key: { args: [], returns: I32 },
			shim_preview_window_number: { args: [], returns: I32 },
			shim_preview_owner: { args: [], returns: P },
			shim_preview_owner_live: { args: [], returns: I32 },
			shim_preview_reason: { args: [], returns: CS },
			shim_preview_probe_count: { args: [], returns: I32 },
			shim_preview_probe_item_url: { args: [I32], returns: CS },
		},
	}) as unknown as PreviewUnit;
}

let unitOnce: PreviewUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms and runs on the first show. */
export function previewUnit(): PreviewUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: preview needs AppKit, and this is ${process.platform}`);
	}
	return (unitOnce ??= compile());
}

/** Compile the unit and report whether every export resolved. Nothing is shown. */
export function previewUnitStatus(): { available: boolean; reason: string } {
	try {
		const compiled = previewUnit();
		const reachable = Number(compiled.symbols.shim_preview_available() ?? 0) === 1;
		return reachable
			? { available: true, reason: "QLPreviewPanel is reachable" }
			: { available: false, reason: String(compiled.symbols.shim_preview_reason() ?? "") };
	} catch (error) {
		return { available: false, reason: message(error) };
	}
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// A strong reference for the duration of one send: `bun:ffi` reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

/** The real native half: one call per method, bytes built here. */
export function darwinPreviewNative(): PreviewNative {
	// Read as an object, never destructured out of a returned tuple: on Bun 1.4.5 a value
	// destructured from an array arrives at a `bun:ffi` call as the wrong number (measured: this
	// exact call answering 0 for a path list it was given).
	const symbols = () => previewUnit().symbols;
	return {
		available: () => Number(symbols().shim_preview_available() ?? 0),
		setPaths: (text) => {
			const bytes = bytesOf(text);
			return Number(symbols().shim_preview_set_paths(bytes.address, bytes.length) ?? 0);
		},
		owner: () => Number(symbols().shim_preview_owner() ?? 0),
		show: (owner, width, height) =>
			Number(symbols().shim_preview_show(owner, width, height) ?? PREVIEW_STATUS.refused),
		hide: () => Number(symbols().shim_preview_hide() ?? PREVIEW_STATUS.refused),
		visible: () => Number(symbols().shim_preview_visible() ?? 0) === 1,
		key: () => Number(symbols().shim_preview_key() ?? 0) === 1,
		windowNumber: () => Number(symbols().shim_preview_window_number() ?? 0),
		ownerLive: () => Number(symbols().shim_preview_owner_live() ?? 1),
		reason: () => String(symbols().shim_preview_reason() ?? ""),
	};
}
