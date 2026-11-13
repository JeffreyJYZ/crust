/**
 * The macOS menu-bar status item behind `crust:tray`.
 *
 * `NSStatusBar` lives in `status_bar.c`, compiled at launch by `cc()` with the
 * same route `index.ts` uses for the shim: no artifact, no Xcode, AppKit and
 * Foundation linked by name. This module is the TypeScript half — one opaque
 * `NSStatusItem *` held as a number, titles passed as encoded buffers, and the
 * clicked menu row routed back from the Objective-C runtime class whose IMP is
 * the `JSCallback` below (research/cc.md §5, DESIGN.md §2 trap 3).
 *
 * `createStatusBar()` returns exactly the `TrayNative` shape, so it is the
 * darwin adapter without a second wrapper: `createTrayPlugin(createStatusBar())`.
 * It is deliberately not wired into `runtime.ts`.
 *
 * Limits this module states instead of hiding:
 *
 *   - One live status bar per process. `createStatusBar()` throws while another
 *     is alive, because the runtime class holds a single click IMP and a single
 *     target instance; every menu row of every live item would otherwise share
 *     one handler set. Destroying frees the slot, and the same click trampoline
 *     is reused, so repeated create/destroy does not allocate per cycle.
 *   - The click trampoline is never closed. Freeing it while an AppKit menu row
 *     still points at the target is a SIGABRT with no JavaScript error, so it
 *     lives for the process lifetime.
 *   - A title longer than `tray_title_capacity()` bytes is applied but not
 *     verified: the readback buffer is bounded, and comparing a truncated
 *     string would report a false failure.
 */

import { cc, FFIType, JSCallback, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c
// file does not exist, so the source travels inside the binary as text and is
// materialised to a temp file before `cc()` is called. Same route as shim.c.
import statusBarSource from "./status_bar.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const V = FFIType.void;
const CS = FFIType.cstring;

/** Every symbol `status_bar.c` exports, in the order the file declares them. */
export const STATUS_BAR_SYMBOL_NAMES = [
	"tray_abi",
	"tray_create",
	"tray_set_title",
	"tray_title_copy",
	"tray_title_capacity",
	"tray_set_visible",
	"tray_menu_begin",
	"tray_menu_add",
	"tray_menu_end",
	"tray_menu_clear",
	"tray_menu_count",
	"tray_item_index",
	"tray_destroy",
] as const;

export type StatusBarSymbolName = (typeof STATUS_BAR_SYMBOL_NAMES)[number];

// `bun:ffi` types a pointer as a nominal number and a `ptr` argument as
// Pointer|TypedArray|bigint, while the runtime value here is always a plain
// number. One cast at compile() keeps every call site honest numbers.
type LooseSymbol = (
	...args: Array<number | bigint | string | null | undefined>
) => number | bigint | string | null | undefined;

export interface StatusBarShim {
	symbols: Record<StatusBarSymbolName, LooseSymbol>;
}

function materialisedSource(): string {
	const hash = createHash("sha256").update(statusBarSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-status-bar-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, statusBarSource);
	return path;
}

function compile(): StatusBarShim {
	return cc({
		source: materialisedSource(),
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			tray_abi: { args: [], returns: I32 },
			tray_create: { args: [P], returns: P },
			tray_set_title: { args: [P, P, I64], returns: I32 },
			tray_title_copy: { args: [P], returns: CS },
			tray_title_capacity: { args: [], returns: I32 },
			tray_set_visible: { args: [P, I32], returns: I32 },
			tray_menu_begin: { args: [P], returns: I32 },
			tray_menu_add: { args: [P, I64, I32], returns: I32 },
			tray_menu_end: { args: [P], returns: I32 },
			tray_menu_clear: { args: [P], returns: I32 },
			tray_menu_count: { args: [P], returns: I32 },
			tray_item_index: { args: [P], returns: I32 },
			tray_destroy: { args: [P], returns: V },
		},
	}) as unknown as StatusBarShim;
}

let shimOnce: StatusBarShim | undefined;

/** Compile the status-bar unit at most once per process. */
export function statusBar(): StatusBarShim {
	return (shimOnce ??= compile());
}

// --- arguments -------------------------------------------------------------

// A JS string cannot be passed into compiled C, so a `const char *` parameter
// gets an encoded buffer whose bytes stay reachable for the process lifetime.
const buffers = new Set<Uint8Array>();
const cbufCache = new Map<string, { p: number; len: number }>();

function cbuf(s: string): { p: number; len: number } {
	let cached = cbufCache.get(s);
	if (cached === undefined) {
		const bytes = new TextEncoder().encode(`${s}\0`);
		buffers.add(bytes);
		cached = { p: ptr(bytes), len: bytes.length - 1 };
		cbufCache.set(s, cached);
	}
	return cached;
}

// A pointer arrives from bun:ffi as an exact number. Anything else is a 64-bit
// integer return (BigInt) or a missing symbol; refuse it rather than coerce it,
// because a mangled pointer faults at 0x10 later on.
function ptrValue(v: unknown, what: string): number {
	if (typeof v === "number") return v;
	if (v === undefined) throw new Error(`${what} returned undefined`);
	throw new Error(`${what} returned ${typeof v}, not an exact pointer`);
}

function checked(v: unknown, what: string): void {
	const status = Number(v ?? 0);
	if (status !== 1) {
		throw new Error(`crust: ${what} was refused by AppKit (a selector it needs is absent)`);
	}
}

// --- the status item -------------------------------------------------------

export interface StatusBarMenuItem {
	label: string;
	onClick?: () => void;
}

export interface StatusBar {
	/** Replace the text beside the icon. Empty is legal and shows no text. */
	setTitle(text: string): void;
	/** Put the item back on the menu bar. */
	show(): void;
	/** Take the item off the menu bar; it stays alive. */
	hide(): void;
	/** Replace the whole menu. An empty list detaches it. */
	setMenu(items: readonly StatusBarMenuItem[]): void;
	/** Remove the item from the status bar. A second call is a no-op. */
	destroy(): void;
}

let live: StatusBar | undefined;

// The click trampoline is one per process: the runtime class registers one IMP,
// so a second JSCallback would never be reached. The dispatch target is swapped
// by each live status bar instead.
let clickCallback: JSCallback | undefined;
let clickRoute: ((index: number) => void) | undefined;

function clickChannel(native: StatusBarShim): JSCallback {
	if (clickCallback !== undefined) return clickCallback;
	clickCallback = new JSCallback(
		(_self: number, _cmd: number, sender: number) => {
			// The sender's `tag` is the row index this module set; reading it is a
			// C call, so no Objective-C object is held on the JavaScript side.
			const index = Number(native.symbols.tray_item_index(Number(sender)) ?? -1);
			if (index < 0) return;
			try {
				clickRoute?.(index);
			} catch {
				// An exception crossing back into AppKit aborts the process.
			}
		},
		{ args: [P, P, P], returns: V },
	);
	return clickCallback;
}

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	if (typeof raw === "number") return raw;
	if (typeof raw === "bigint") return Number(raw);
	throw new Error("crust: JSCallback exposed no usable pointer");
}

/**
 * Build a status item. Throws when another one is alive: the runtime class has
 * one click IMP and one target instance, so two live items would share a
 * handler set and clicks would fire the wrong menu's callbacks.
 */
export function createStatusBar(): StatusBar {
	if (live !== undefined) {
		throw new Error(
			"crust: one status bar per process; call destroy() on the live one before creating another",
		);
	}

	const native = statusBar();
	const imp = clickChannel(native);
	const item = ptrValue(native.symbols.tray_create(callbackPointer(imp)), "tray_create");
	if (!item) throw new Error("crust: NSStatusBar refused to create a status item");

	const capacity = Number(native.symbols.tray_title_capacity() ?? 0);
	if (capacity <= 0) throw new Error("crust: status_bar.c exposed no title buffer");

	let entries: readonly StatusBarMenuItem[] = [];
	let destroyed = false;

	const requireLive = (what: string): number => {
		if (destroyed || !item) {
			throw new Error(`crust: status bar was destroyed; ${what} needs a live item`);
		}
		return item;
	};

	const bar: StatusBar = {
		setTitle(text: string): void {
			const target = requireLive("setTitle");
			const { p, len } = cbuf(text);
			checked(native.symbols.tray_set_title(target, p, len), "setTitle");
			const applied = String(native.symbols.tray_title_copy(target) ?? "");
			if (len <= capacity - 1 && applied !== text) {
				throw new Error(`crust: status title applied as ${JSON.stringify(applied)}`);
			}
		},

		show(): void {
			checked(native.symbols.tray_set_visible(requireLive("show"), 1), "show");
		},

		hide(): void {
			checked(native.symbols.tray_set_visible(requireLive("hide"), 0), "hide");
		},

		setMenu(items: readonly StatusBarMenuItem[]): void {
			const target = requireLive("setMenu");
			// Copy first: a caller mutating its array must not change what a click
			// dispatches to.
			const next = items.map((entry) => ({ label: entry.label, onClick: entry.onClick }));

			if (next.length === 0) {
				checked(native.symbols.tray_menu_clear(target), "setMenu (clear)");
				entries = [];
				return;
			}

			checked(native.symbols.tray_menu_begin(target), "setMenu (begin)");
			for (let index = 0; index < next.length; index++) {
				const entry = next[index];
				if (entry === undefined) continue;
				const { p, len } = cbuf(entry.label);
				checked(native.symbols.tray_menu_add(p, len, index), `setMenu (row ${index})`);
			}
			checked(native.symbols.tray_menu_end(target), "setMenu (end)");
			entries = next;
		},

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			entries = [];
			clickRoute = undefined;
			native.symbols.tray_destroy(item);
			live = undefined;
		},
	};

	clickRoute = (index: number) => {
		const entry = entries[index];
		if (entry === undefined) return;
		entry.onClick?.();
	};

	live = bar;
	return bar;
}
