/**
 * macOS platform implementation: AppKit over `bun:ffi`, no native artifact.
 *
 * Ported from the M0 spike (`spike/main.ts`, measured working: window visible at
 * 299.5 ms, webview 165 ms, page 925 ms, two resizes survived). DESIGN.md §2
 * explains why the shim exists; §3 explains the pump.
 *
 * Every selector is preflighted once, because an uncaught Objective-C exception
 * terminates the process with SIGABRT and no JavaScript error. Nothing here
 * passes a JS string into C: `const char *` parameters get an encoded buffer,
 * and every object stays native-side as an opaque pointer.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform, WindowHandle, WindowOptions } from "@/app.ts";
import type {
	DialogNative,
	OpenPanelOptions,
	OpenPanelResult,
	SavePanelOptions,
	SavePanelResult,
} from "@/plugins/dialog";
import { WindowAdapterError, type WindowNative } from "@/plugins/window";

// Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c file
// does not exist. The shim therefore travels inside the binary as text and is
// materialised to a temp file before `cc()` is called.
import shimSource from "./shim.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;
const CS = FFIType.cstring;

/** Compile the shipped C shim. `cc()` compiles C only, and a framework must be linked. */
function compile() {
	/** Materialise the embedded shim and return its path. Content-hashed, so a
	 * second launch reuses the same file and TinyCC's per-path cache. */
	function shimPath(): string {
		const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
		const path = join(tmpdir(), `crust-shim-${hash}.c`);
		if (!existsSync(path)) writeFileSync(path, shimSource);
		return path;
	}

	return cc({
		source: shimPath(),
		flags: [
			"-framework",
			"AppKit",
			"-framework",
			"Foundation",
			"-framework",
			"WebKit",
			"-framework",
			"CoreFoundation",
		],
		symbols: {
			shim_cls: { args: [P], returns: P },
			shim_sel: { args: [P], returns: P },
			shim_object_class: { args: [P], returns: P },
			shim_class_name: { args: [P], returns: CS },
			shim_name_of_class: { args: [P], returns: CS },
			shim_instance_method: { args: [P, P], returns: P },
			shim_responds: { args: [P, P], returns: I32 },

			shim_send_p0: { args: [P, P], returns: P },
			shim_send_p1: { args: [P, P, P], returns: P },
			shim_send_p2: { args: [P, P, P, P], returns: P },
			shim_send_p3: { args: [P, P, P, P, P], returns: P },
			shim_send_pq1: { args: [P, P, I64], returns: P },
			shim_send_pd1: { args: [P, P, F64], returns: P },
			shim_send_pb1: { args: [P, P, I32], returns: P },

			shim_send_b0: { args: [P, P], returns: I32 },
			shim_send_b1: { args: [P, P, P], returns: I32 },
			shim_send_q0: { args: [P, P], returns: I64 },
			shim_send_q1: { args: [P, P, I64], returns: I64 },

			shim_send_v0: { args: [P, P], returns: V },
			shim_send_v1: { args: [P, P, P], returns: V },
			shim_send_v2: { args: [P, P, P, P], returns: V },
			shim_send_vb1: { args: [P, P, I32], returns: V },
			shim_send_vq1: { args: [P, P, I64], returns: V },
			shim_send_vd1: { args: [P, P, F64], returns: V },

			shim_new: { args: [P], returns: P },
			shim_cstr_len: { args: [P], returns: I64 },
			shim_webview_load: { args: [P, P], returns: I32 },

			shim_constraint: { args: [P, I64, I64, P, I64, F64, F64], returns: P },
			shim_constraint_simple: { args: [P, I64, I64, F64], returns: P },
			shim_frame_num: { args: [P, I32], returns: F64 },
			shim_window_new: { args: [F64, F64, F64, F64, I64, I64, I32], returns: P },
			shim_window_set_min_size: { args: [P, F64, F64], returns: V },
			shim_window_set_title: { args: [P, P], returns: V },
			shim_window_title_utf8: { args: [P], returns: CS },
			shim_window_number: { args: [P], returns: I64 },
			shim_window_is_visible: { args: [P], returns: I32 },
			shim_window_is_released_when_closed: { args: [P], returns: I32 },
			shim_window_is_key: { args: [P], returns: I32 },
			shim_window_is_miniaturized: { args: [P], returns: I32 },

			shim_app_load: { args: [], returns: I32 },
			shim_pool_new: { args: [], returns: P },
			shim_pool_init: { args: [P], returns: P },
			shim_pool_drain: { args: [P], returns: V },

			shim_mode: { args: [], returns: P },
			shim_mode_ok: { args: [P], returns: I32 },
			shim_pump: { args: [P], returns: I32 },

			// The open panel: an int status in, and the chosen paths read back
			// one at a time as C strings. No object and no struct crosses. The
			// save panel shares the storage and the status set.
			shim_open_panel: { args: [P, P, I32, I32, I32], returns: I32 },
			shim_open_panel_count: { args: [], returns: I32 },
			shim_open_panel_path: { args: [I32], returns: CS },
			// title, suggested file name, filter list, runModal.
			shim_save_panel: { args: [P, P, P, I32], returns: I32 },

			// The sheet's answer, polled while the pump keeps running. -cancel:
			// is the test's way to end a sheet with no human.
			shim_sheet_done: { args: [], returns: I32 },
			shim_sheet_response: { args: [], returns: I64 },
			shim_sheet_cancel: { args: [], returns: I32 },
		},
	}) as unknown as Shim;
}

// bun:ffi types a pointer as a nominal number and a `ptr` argument as
// Pointer|TypedArray|bigint, while the runtime value here is always a plain
// number. One cast at compile() keeps every call site honest numbers and every
// guard in this file unchanged.
type LooseSymbol = (
	...args: Array<number | bigint | string | null | undefined>
) => number | bigint | string | null | undefined;

export interface Shim {
	symbols: {
		shim_cls: LooseSymbol;
		shim_sel: LooseSymbol;
		shim_object_class: LooseSymbol;
		shim_class_name: LooseSymbol;
		shim_name_of_class: LooseSymbol;
		shim_instance_method: LooseSymbol;
		shim_responds: LooseSymbol;

		shim_send_p0: LooseSymbol;
		shim_send_p1: LooseSymbol;
		shim_send_p2: LooseSymbol;
		shim_send_p3: LooseSymbol;
		shim_send_pq1: LooseSymbol;
		shim_send_pd1: LooseSymbol;
		shim_send_pb1: LooseSymbol;

		shim_send_b0: LooseSymbol;
		shim_send_b1: LooseSymbol;
		shim_send_q0: LooseSymbol;
		shim_send_q1: LooseSymbol;

		shim_send_v0: LooseSymbol;
		shim_send_v1: LooseSymbol;
		shim_send_v2: LooseSymbol;
		shim_send_vb1: LooseSymbol;
		shim_send_vq1: LooseSymbol;
		shim_send_vd1: LooseSymbol;

		shim_new: LooseSymbol;
		shim_cstr_len: LooseSymbol;
		shim_webview_load: LooseSymbol;

		shim_constraint: LooseSymbol;
		shim_constraint_simple: LooseSymbol;
		shim_frame_num: LooseSymbol;
		shim_window_new: LooseSymbol;
		shim_window_set_min_size: LooseSymbol;
		shim_window_set_title: LooseSymbol;
		shim_window_title_utf8: LooseSymbol;
		shim_window_number: LooseSymbol;
		shim_window_is_visible: LooseSymbol;
		shim_window_is_released_when_closed: LooseSymbol;
		shim_window_is_key: LooseSymbol;
		shim_window_is_miniaturized: LooseSymbol;

		shim_app_load: LooseSymbol;
		shim_pool_new: LooseSymbol;
		shim_pool_init: LooseSymbol;
		shim_pool_drain: LooseSymbol;

		shim_mode: LooseSymbol;
		shim_mode_ok: LooseSymbol;
		shim_pump: LooseSymbol;

		shim_open_panel: LooseSymbol;
		shim_open_panel_count: LooseSymbol;
		shim_open_panel_path: LooseSymbol;
		shim_save_panel: LooseSymbol;

		shim_sheet_done: LooseSymbol;
		shim_sheet_response: LooseSymbol;
		shim_sheet_cancel: LooseSymbol;
	};
}

let shimOnce: Shim | undefined;
/** Compile the shim at most once per process; `cc()` takes 3–20 ms. */
export function shim(): Shim {
	return (shimOnce ??= compile());
}

// --- arguments -------------------------------------------------------------

// A JS string cannot be passed into compiled C, so every `const char *`
// parameter gets an encoded buffer whose bytes stay reachable for the process
// lifetime. One buffer per distinct string, cached.
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

const cstr = (s: string): number => cbuf(s).p;

// A pointer arrives from bun:ffi as an exact number. Anything else is a 64-bit
// integer return (BigInt) or a missing symbol; refuse it rather than coerce it,
// because a mangled pointer faults at 0x10 later on.
function ptrValue(v: unknown, what: string): number {
	if (typeof v === "number") return v;
	if (v === undefined) throw new Error(`${what} returned undefined`);
	throw new Error(`${what} returned ${typeof v}, not an exact pointer`);
}

const selCache = new Map<string, number>();
function SEL(name: string): number {
	let s = selCache.get(name);
	if (s === undefined) {
		s = ptrValue(shim().symbols.shim_sel(cstr(name)), `sel_registerName("${name}")`);
		if (s === 0) throw new Error(`sel_registerName("${name}") returned null`);
		selCache.set(name, s);
	}
	return s;
}

const clsCache = new Map<string, number>();
function cls(name: string): number {
	let c = clsCache.get(name);
	if (c === undefined) {
		c = ptrValue(shim().symbols.shim_cls(cstr(name)), `objc_getClass("${name}")`);
		if (c === 0) throw new Error(`objc_getClass("${name}") is null (framework not linked?)`);
		clsCache.set(name, c);
	}
	return c;
}

// --- selectors -------------------------------------------------------------

/**
 * Every selector this file sends, checked once before the application starts.
 *
 * `kind: "class"` means the receiver is a class object, and the honest test is
 * `[class respondsToSelector:]`. `kind: "instance"` means an instance method,
 * and the honest test is `class_getInstanceMethod`, which walks the superclass
 * chain. `class_getClassMethod` is never used: it reports `+init`/`+valueForKey:`
 * as present on every class through the metaclass chain.
 */
export interface PreflightEntry {
	owner: string;
	selector: string;
	kind: "class" | "instance";
}

const classSelectors: ReadonlyArray<readonly [string, string]> = [
	["NSApplication", "sharedApplication"],
	["NSWindow", "alloc"],
	["NSView", "alloc"],
	["WKWebView", "alloc"],
	[
		"NSLayoutConstraint",
		"constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:",
	],
	["NSLayoutConstraint", "constraintWithItem:attribute:relatedBy:constant:"],
];

const instanceSelectors: ReadonlyArray<readonly [string, string]> = [
	["NSWindow", "initWithContentRect:styleMask:backing:defer:"],
	["NSWindow", "setReleasedWhenClosed:"],
	["NSWindow", "contentView"],
	["NSWindow", "makeKeyAndOrderFront:"],
	["NSWindow", "setTitle:"],
	["NSWindow", "title"],
	["NSWindow", "setContentMinSize:"],
	["NSWindow", "windowNumber"],
	["NSWindow", "isVisible"],
	["NSWindow", "isMiniaturized"],
	["NSWindow", "isReleasedWhenClosed"],
	["NSWindow", "isKeyWindow"],
	["NSWindow", "close"],
	["WKWebView", "init"],
	["WKWebView", "loadRequest:"],
	["NSApplication", "setActivationPolicy:"],
	["NSApplication", "isHidden"],
	["NSApplication", "activateIgnoringOtherApps:"],
	["NSApplication", "terminate:"],
	["NSView", "addSubview:"],
	["NSView", "setTranslatesAutoresizingMaskIntoConstraints:"],
	["NSLayoutConstraint", "setActive:"],
];

/** The selectors `shim.c` itself sends; JS must verify them, C cannot. */
const internalClassSelectors: ReadonlyArray<readonly [string, string]> = [
	["NSString", "alloc"],
	["NSURL", "URLWithString:"],
	["NSURLRequest", "requestWithURL:"],
	// The open and save panels' C sections build every object they send to, so
	// these are verified here rather than at a call site JS can see.
	["NSOpenPanel", "openPanel"],
	["NSSavePanel", "savePanel"],
	["NSMutableArray", "array"],
];

const internalInstanceSelectors: ReadonlyArray<readonly [string, string]> = [
	// NSString is a class cluster: +alloc yields an NSPlaceholderString, and that
	// concrete class is where -initWithBytes:length:encoding: is implemented.
	["NSPlaceholderString", "initWithBytes:length:encoding:"],
	["NSWindow", "valueForKey:"],
	["NSValue", "getValue:"],
	["NSView", "valueForKey:"],
	// NSOpenPanel. `-beginSheetModalForWindow:completionHandler:` is the reason
	// the pick no longer blocks; `-cancel:` is what ends a sheet with no human.
	["NSOpenPanel", "setCanChooseFiles:"],
	["NSOpenPanel", "setCanChooseDirectories:"],
	["NSOpenPanel", "setAllowsMultipleSelection:"],
	["NSOpenPanel", "setTitle:"],
	["NSOpenPanel", "setAllowedFileTypes:"],
	["NSOpenPanel", "beginSheetModalForWindow:completionHandler:"],
	["NSOpenPanel", "runModal"],
	["NSOpenPanel", "cancel:"],
	["NSOpenPanel", "URLs"],
	// NSSavePanel: the same sheet and cancel machinery, a name field instead of
	// a selection shape, and -URL (singular) for the one chosen path.
	["NSSavePanel", "setTitle:"],
	["NSSavePanel", "setNameFieldStringValue:"],
	["NSSavePanel", "setAllowedFileTypes:"],
	["NSSavePanel", "beginSheetModalForWindow:completionHandler:"],
	["NSSavePanel", "runModal"],
	["NSSavePanel", "cancel:"],
	["NSSavePanel", "URL"],
	// The window a sheet attaches to, and the reads the fallback path makes.
	["NSApplication", "keyWindow"],
	["NSApplication", "mainWindow"],
	["NSApplication", "windows"],
	["NSMutableArray", "addObject:"],
	// -URLs is an NSArray; each element's -path is copied into C storage.
	["NSArray", "count"],
	["NSArray", "objectAtIndex:"],
	["NSURL", "path"],
	["NSString", "UTF8String"],
];

export const PREFLIGHT: readonly PreflightEntry[] = [
	...classSelectors.map(([owner, selector]) => ({ owner, selector, kind: "class" as const })),
	...instanceSelectors.map(([owner, selector]) => ({
		owner,
		selector,
		kind: "instance" as const,
	})),
	...internalClassSelectors.map(([owner, selector]) => ({
		owner,
		selector,
		kind: "class" as const,
	})),
	...internalInstanceSelectors.map(([owner, selector]) => ({
		owner,
		selector,
		kind: "instance" as const,
	})),
];

/**
 * Resolve one preflight entry against the runtime. Returns an error string
 * (never throws) so `start()` can name every missing selector at once.
 */
export function preflightError(entry: PreflightEntry): string | undefined {
	try {
		const target = cls(entry.owner);
		const sel = SEL(entry.selector);
		if (entry.kind === "class") {
			const responds = Number(shim().symbols.shim_responds(target, sel) ?? 0) === 1;
			return responds ? undefined : `+[${entry.owner} ${entry.selector}] not implemented`;
		}
		const method = shim().symbols.shim_instance_method(target, sel) ?? 0;
		return ptrValueZero(method) !== 0
			? undefined
			: `-[${entry.owner} ${entry.selector}] not implemented`;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

// `shim_instance_method` returns a pointer but a null Method is a legitimate
// zero, so it cannot go through ptrValue, which refuses anything but a number.
function ptrValueZero(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "bigint") return Number(v);
	return 0;
}

// --- guard -----------------------------------------------------------------

// An uncaught Objective-C exception terminates the process with SIGABRT and no
// JavaScript error, so every send is checked against the receiver first and the
// answer cached per (class, selector).
const guardCache = new Map<string, boolean>();

function guard(recv: number, name: string, asClass: boolean): boolean {
	if (!recv) throw new Error(`guard(${name}): receiver is null`);
	const owner = asClass
		? String(shim().symbols.shim_name_of_class(recv) ?? "?")
		: String(shim().symbols.shim_class_name(recv) ?? "?");
	const key = `${asClass ? "+" : "-"}[${owner} ${name}]`;
	const cached = guardCache.get(key);
	if (cached !== undefined) return cached;

	const sel = SEL(name);
	const responds = Number(shim().symbols.shim_responds(recv, sel) ?? 0) === 1;
	const method = asClass
		? true
		: ptrValueZero(
				shim().symbols.shim_instance_method(
					ptrValue(shim().symbols.shim_object_class(recv), "object_getClass"),
					sel,
				),
			) !== 0;
	const ok = responds && method;
	guardCache.set(key, ok);
	return ok;
}

function must(recv: number, name: string, asClass = false): void {
	if (!guard(recv, name, asClass)) throw new Error(`refused to send ${name}: guard failed`);
}

// Every send goes through exactly one of these, and each guards first.
const S = {
	p0: (r: number, n: string, c = false) => (
		must(r, n, c),
		ptrValue(shim().symbols.shim_send_p0(r, SEL(n)), n)
	),
	p1: (r: number, n: string, a: number) => (
		must(r, n),
		ptrValue(shim().symbols.shim_send_p1(r, SEL(n), a), n)
	),
	p2: (r: number, n: string, a: number, b: number) => (
		must(r, n),
		ptrValue(shim().symbols.shim_send_p2(r, SEL(n), a, b), n)
	),
	p3: (r: number, n: string, a: number, b: number, d: number) => (
		must(r, n),
		ptrValue(shim().symbols.shim_send_p3(r, SEL(n), a, b, d), n)
	),
	pq1: (r: number, n: string, v: number | bigint) => (
		must(r, n),
		ptrValue(shim().symbols.shim_send_pq1(r, SEL(n), typeof v === "bigint" ? v : BigInt(v)), n)
	),
	pd1: (r: number, n: string, v: number) => (
		must(r, n),
		ptrValue(shim().symbols.shim_send_pd1(r, SEL(n), v), n)
	),
	b0: (r: number, n: string) => (
		must(r, n),
		Number(shim().symbols.shim_send_b0(r, SEL(n)) ?? 0) !== 0
	),
	b1: (r: number, n: string, a: number) => (
		must(r, n),
		Number(shim().symbols.shim_send_b1(r, SEL(n), a) ?? 0) !== 0
	),
	q0: (r: number, n: string) => (must(r, n), Number(shim().symbols.shim_send_q0(r, SEL(n)) ?? 0)),
	v0: (r: number, n: string) => (must(r, n), shim().symbols.shim_send_v0(r, SEL(n))),
	v1: (r: number, n: string, a: number) => (
		must(r, n),
		shim().symbols.shim_send_v1(r, SEL(n), a)
	),
	v2: (r: number, n: string, a: number, b: number) => (
		must(r, n),
		shim().symbols.shim_send_v2(r, SEL(n), a, b)
	),
	vb1: (r: number, n: string, v: number) => (
		must(r, n),
		shim().symbols.shim_send_vb1(r, SEL(n), v)
	),
	vq1: (r: number, n: string, v: number | bigint) => (
		must(r, n),
		shim().symbols.shim_send_vq1(r, SEL(n), typeof v === "bigint" ? v : BigInt(v))
	),
};

function allocInit(className: string): number {
	const allocated = S.p0(cls(className), "alloc", true);
	return S.p0(allocated, "init");
}

// --- the platform ----------------------------------------------------------

interface NativeWindow {
	handle: WindowHandle;
	win: number;
	web: number;
	/**
	 * The absolute URL this window was asked to load (`about:blank` when the
	 * caller gave a relative one, which `NSURL` cannot take as-is). Kept because
	 * a window created later resolves a relative URL against the app's own
	 * document, and this is the only place that document survives: the bridge
	 * URL is the runtime's, never the platform's.
	 */
	url: string;
}

/**
 * What AppKit reports about a window, as the liveness rule needs it.
 *
 * `appHidden` is separate because hiding the app orders every window out and is
 * not a close.
 */
export interface WindowLivenessState {
	visible: boolean;
	miniaturized: boolean;
	appHidden: boolean;
}

/**
 * Whether a window is still open, from the three AppKit reads that answer it.
 *
 * **`-windowNumber` is not a liveness test**, which is what broke
 * `window-all-closed` for every crust app. Measured 2026-11-13 on macOS 27:
 * `-close` takes effect immediately (`isVisible` 1 → 0 within 1.02 ms of the
 * send, still 0 after 300 ms and after 1 s of pumping) and the window device
 * number never clears — 517 stayed 517 through `-close`, and a second window
 * stayed 518 through `-orderOut:` followed by `-close`. AppKit keeps the number
 * for the life of the window object, so a window that has been shown once
 * reports a non-zero number forever and `windowNumber === 0` can only ever
 * detect a window that was never ordered in.
 *
 * The measured rule instead:
 *
 *   - visible        → open (the normal case, and after an unhide)
 *   - miniaturised   → open: not visible, and definitely not closed
 *   - app hidden     → open: Cmd+H orders every window out without closing one
 *   - none of those  → closed, including a window never ordered in
 */
export function windowLiveness(state: WindowLivenessState): boolean {
	return state.visible || state.miniaturized || state.appHidden;
}

/**
 * The macOS `Platform`. Construct through `createPlatform()`; the class is
 * exported because the pump and its timer are testable without a window.
 */
export class DarwinPlatform implements Platform {
	readonly #appName: string;
	#app = 0;
	/** Activation happens at most once per process: repeating it makes the app
	 * keep jumping into the foreground every time a window is re-created. */
	#activated = false;
	#mode = 0;
	#started = false;
	#pumping = false;
	#pumpTimer: ReturnType<typeof setTimeout> | undefined;
	#ticks = 0;
	readonly #windows = new Map<string, NativeWindow>();

	constructor(options: { appName?: string } = {}) {
		this.#appName = options.appName ?? "crust";
	}

	/**
	 * Compile the shim, preflight every selector, then bring AppKit up in the
	 * measured order: NSApplicationLoad → sharedApplication → policy.
	 */
	async start(): Promise<void> {
		if (this.#started) return;
		shim();

		const failures: string[] = [];
		for (const entry of PREFLIGHT) {
			const error = preflightError(entry);
			if (error) failures.push(error);
		}
		if (failures.length > 0) {
			throw new Error(
				`${this.#appName}: selector preflight failed:\n  ${failures.join("\n  ")}`,
			);
		}

		const loaded = Number(shim().symbols.shim_app_load() ?? 0);
		if (!loaded) throw new Error("NSApplicationLoad returned false");

		const app = S.p0(cls("NSApplication"), "sharedApplication", true);
		if (!app) throw new Error("+[NSApplication sharedApplication] returned null");
		this.#app = app;
		S.vq1(app, "setActivationPolicy:", 0);
		this.ensureRunLoopMode();
		this.#started = true;
	}

	/**
	 * Pump Cocoa from a self-rearming `setTimeout` chain. A repeating interval is
	 * more likely to be coalesced under power saving (DESIGN.md §3).
	 */
	pump(intervalMs: number): void {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			throw new Error(`pump: intervalMs must be a positive number, got ${intervalMs}`);
		}
		this.ensureRunLoopMode();
		if (this.#pumping) this.stopPump();
		this.#pumping = true;
		const tick = () => {
			if (!this.#pumping) return;
			shim().symbols.shim_pump(this.#mode);
			this.#ticks++;
			this.#pumpTimer = setTimeout(tick, intervalMs);
		};
		tick();
	}

	/** Stop the pump timer. `quit()` calls this; tests call it directly. */
	stopPump(): void {
		this.#pumping = false;
		if (this.#pumpTimer !== undefined) clearTimeout(this.#pumpTimer);
		this.#pumpTimer = undefined;
	}

	/** Whether a pump timer is currently armed. */
	get pumping(): boolean {
		return this.#pumping;
	}

	/** How many slices this pump has run. Used by the timer test. */
	get ticks(): number {
		return this.#ticks;
	}

	/**
	 * Build the window with `initWithContentRect:` on the C stack (a bare
	 * `[[NSWindow alloc] init]` aborts from AppKit's event thread), add the
	 * webview, pin it with Auto Layout, order front, then load the URL inside C.
	 */
	createWindow(options: WindowOptions): WindowHandle {
		const label = options.label;
		if (!label) throw new Error("createWindow: label must not be empty");
		if (this.#windows.has(label))
			throw new Error(`createWindow: window "${label}" already exists`);

		const width = options.width ?? 1100;
		const height = options.height ?? 760;
		// titled(1) | closable(2) | miniaturizable(4) | resizable(8)
		const win = Number(shim().symbols.shim_window_new(120, 120, width, height, 15n, 2n, 0));
		if (!win) throw new Error("shim_window_new returned null");
		// minWidth was validated and carried but read by nobody; it lands here, where
		// the window exists and the size is still ours to constrain.
		if (options.minWidth !== undefined) {
			shim().symbols.shim_window_set_min_size(win, options.minWidth, height);
		}

		// A closed window must stay addressable: `-close` does not release it,
		// and the liveness read afterwards needs the object alive. Released, the
		// pointer would dangle and the next guarded send would fault.
		S.vb1(win, "setReleasedWhenClosed:", 0);

		const web = allocInit("WKWebView");
		if (!web) throw new Error("[[WKWebView alloc] init] returned null");

		const content = S.p0(win, "contentView");
		if (!content) throw new Error("-[NSWindow contentView] returned null");
		S.v1(content, "addSubview:", web);
		S.vb1(web, "setTranslatesAutoresizingMaskIntoConstraints:", 0);
		S.vb1(content, "setTranslatesAutoresizingMaskIntoConstraints:", 0);

		// Auto Layout replaces setFrame:. Attributes: 3 top, 4 bottom, 5 leading,
		// 6 trailing, 7 width, 8 height; relatedBy 0 is equal.
		const constraints: unknown[] = [
			shim().symbols.shim_constraint(web, 5n, 0n, content, 5n, 1, 0),
			shim().symbols.shim_constraint(web, 6n, 0n, content, 6n, 1, 0),
			shim().symbols.shim_constraint(web, 3n, 0n, content, 3n, 1, 0),
			shim().symbols.shim_constraint(web, 4n, 0n, content, 4n, 1, 0),
			shim().symbols.shim_constraint_simple(web, 7n, 0n, width),
			shim().symbols.shim_constraint_simple(web, 8n, 0n, height),
		];
		for (const raw of constraints) {
			const constraint = ptrValue(raw, "constraintWithItem:");
			if (!constraint) throw new Error("constraintWithItem: returned null");
			S.vb1(constraint, "setActive:", 1);
		}

		// The title is built and applied inside C: a short ASCII NSString is a
		// tagged pointer and cannot be marshalled through bun:ffi.
		if (options.title) {
			shim().symbols.shim_window_set_title(win, cstr(options.title));
			const applied = String(shim().symbols.shim_window_title_utf8(win) ?? "");
			if (applied !== options.title)
				throw new Error(`window title applied as ${JSON.stringify(applied)}`);
		}

		S.v1(win, "makeKeyAndOrderFront:", 0);
		this.activateOnce();

		// A relative URL needs the bridge server, which the platform does not own;
		// only an absolute URL can be handed to NSURL as-is.
		const raw = options.url ?? "/";
		const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : "about:blank";
		const loaded = Number(shim().symbols.shim_webview_load(web, cstr(url)) ?? 0);
		if (!loaded) throw new Error(`shim_webview_load failed for ${url}`);

		const handle: WindowHandle = { label };
		this.#windows.set(label, { handle, win, web, url });
		return handle;
	}

	/**
	 * The absolute URL a tracked window was asked to load.
	 *
	 * This is what a later `window.create` resolves a relative URL against: the
	 * bridge URL is the runtime's private state (and only a dev handshake puts it
	 * in `CRUST_BRIDGE_URL` / `.crust/dev.json`, neither of which a built app
	 * running from `/` can read), while the document the app's own windows were
	 * loaded with is right here, absolute and already verified by the webview.
	 */
	windowUrl(label: string): string | undefined {
		return this.#windows.get(label)?.url;
	}

	/**
	 * Return the handle only while the window is still open.
	 *
	 * Liveness is `windowLiveness`, not `-windowNumber` (see that rule for the
	 * measurement that ruled the number out). A closed window stays addressable
	 * because `setReleasedWhenClosed: 0` was applied at creation, so its
	 * visibility can still be read after the close.
	 */
	window(label: string): WindowHandle | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.#windowIsOpen(entry.win)) {
			this.#windows.delete(label);
			return undefined;
		}
		return entry.handle;
	}

	/**
	 * The labels this platform still tracks, in creation order.
	 *
	 * A closed window stays in the map (`setReleasedWhenClosed: 0` keeps it
	 * addressable) until `window(label)` prunes it, so this is what the
	 * platform knows about, not only what is on screen.
	 */
	windowLabels(): string[] {
		// Only windows AppKit still holds. A closed window's native object survives on
		// purpose (the liveness read needs it), so the map alone reports windows that
		// are gone — and a page that closed a window and asked for the list saw it back.
		return [...this.#windows.entries()]
			.filter(([, entry]) => this.#windowIsOpen(entry.win))
			.map(([label]) => label);
	}

	/** The native `NSWindow *` behind a tracked label; undefined when never created. */
	nativeWindow(label: string): number | undefined {
		return this.#windows.get(label)?.win;
	}

	/**
	 * The window's AppKit window device number while it is open, or 0 once it
	 * has closed — the liveness number crust's own contract promises, not the
	 * raw `-windowNumber` (which keeps its value after a close; see
	 * `windowLiveness`). Undefined means the label was never created.
	 */
	windowNumber(label: string): number | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.#windowIsOpen(entry.win)) return 0;
		return Number(shim().symbols.shim_window_number(entry.win) ?? 0);
	}

	/** Whether AppKit still holds this window open, read the measured way. */
	#windowIsOpen(win: number): boolean {
		// Hiding the app (Cmd+H) orders every window out without closing one, so
		// it must not read as "all windows gone". A failure here fails safe: no
		// false quit, only a delayed one.
		let appHidden = false;
		if (this.#app) {
			try {
				appHidden = S.b0(this.#app, "isHidden");
			} catch {
				appHidden = false;
			}
		}
		const symbols = shim().symbols;
		return windowLiveness({
			visible: Number(symbols.shim_window_is_visible(win) ?? 0) === 1,
			miniaturized: Number(symbols.shim_window_is_miniaturized(win) ?? 0) === 1,
			appHidden,
		});
	}

	/**
	 * Activate the app at most once per process.
	 *
	 * Every activation re-orders the app above whatever the user was doing, so
	 * repeating it on each window creation or `window.focus` call makes the
	 * Dock icon jump on every call. `#activated` is the one flag both paths
	 * share; a failure is cosmetic and never loses a window.
	 */
	activateOnce(): void {
		if (this.#activated) return;
		this.#activated = true;
		if (!this.#app) return;
		try {
			S.vb1(this.#app, "activateIgnoringOtherApps:", 1);
		} catch {
			// Activation is cosmetic; nothing depends on it.
		}
	}

	/** Stop the pump, ask AppKit to terminate, then leave. */
	quit(): void {
		this.stopPump();
		if (this.#app) {
			try {
				S.v1(this.#app, "terminate:", 0);
			} catch {
				// terminate: can close windows re-entrantly; process.exit is still next.
			}
		}
		process.exit(0);
	}

	/** The verified `kCFRunLoopDefaultMode` CFString, resolved once. */
	private ensureRunLoopMode(): void {
		if (this.#mode) return;
		const mode = ptrValue(shim().symbols.shim_mode(), "shim_mode");
		const ok = Number(shim().symbols.shim_mode_ok(mode) ?? 0) === 1;
		if (!ok) throw new Error("run loop mode did not verify — a wrong mode is a silent no-op");
		this.#mode = mode;
	}
}

/** Build the macOS platform. `appName` names failures, nothing in AppKit reads it. */
export function createPlatform(options: { appName?: string } = {}): DarwinPlatform {
	return new DarwinPlatform(options);
}

// --- dialog adapter --------------------------------------------------------

/**
 * What `shim_open_panel` returns. Mirrors the `SHIM_PANEL_*` defines in
 * `shim.c`; the shim guards every selector itself and reports an absent one as
 * `unsupported` rather than sending it and aborting the process.
 */
export const PANEL_STATUS = {
	/** A pick finished with at least one path. */
	picked: 0,
	/** A pick finished with no path — the user cancelled. */
	cancelled: 1,
	/** `NSOpenPanel`, or a selector it needs, is absent on this system. */
	unsupported: 2,
	/** The sheet is on screen: poll `shim_sheet_done` until it answers. */
	sheetStarted: 3,
	/** A sheet was asked for with no key window; nothing was sent. */
	noWindow: 4,
} as const;

/** `NSModalResponse`, the value the sheet's completion handler records. */
export const NS_MODAL_RESPONSE = {
	ok: 1,
	cancel: 0,
} as const;

/** Mirrors `SHIM_PANEL_MAX_PATHS`: the most paths one pick can store. */
export const PANEL_MAX_PATHS = 32;

/**
 * How often the sheet's done flag is read. One frame at 60 Hz: a 300 ms pick
 * costs ~19 reads, and the promise settles on the next frame after the click.
 * A timer, not a loop, is the point — every wait yields, so the app's own pump
 * keeps running and the bridge keeps answering invokes while the sheet is up.
 */
export const SHEET_POLL_INTERVAL_MS = 16;

/**
 * The native reads a sheet poll needs, named so a test can supply them.
 *
 * `response()` only means anything once `done()` is true; the shim answers
 * `SHIM_PANEL_NO_RESPONSE` (-1) before that, so "cancel" and "no answer yet"
 * are never the same value.
 */
export interface SheetReadings {
	done(): boolean;
	response(): number;
	count(): number;
	path(index: number): string;
}

/**
 * Await a sheet that is already on screen, without blocking.
 *
 * This is the half that makes the sheet path real. `-runModal` stops the
 * JavaScript thread, and with it the Cocoa pump and every in-flight invoke, for
 * as long as the panel is up; a sheet plus this poll leaves both running. The
 * await is a `setTimeout` chain, so the pump's own timer gets its turn between
 * reads.
 *
 * Rejections are the malformed answers, never a user's choice:
 *
 *   - a response that is neither `NSModalResponseOK` nor `NSModalResponseCancel`
 *     (a panel that reports something else is not something to guess about);
 *   - a path count outside `0…PANEL_MAX_PATHS`, which cannot come from the C
 *     storage and means the read is not the one that was written;
 *   - an OK whose path list is empty, or contains an empty string, because OK
 *     means "the user picked" and an empty answer contradicts it.
 *
 * Cancel resolves `{ paths: [] }`, which is exactly what a user clicking Cancel
 * means — the two are never confused, and neither is ever `not-implemented`.
 */
export async function awaitSheetResult(
	readings: SheetReadings,
	options: { intervalMs?: number; command?: string } = {},
): Promise<OpenPanelResult> {
	const intervalMs = options.intervalMs ?? SHEET_POLL_INTERVAL_MS;
	const command = options.command ?? "openPanel";
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
		throw new Error(`crust: awaitSheetResult needs a positive interval, got ${intervalMs}`);
	}

	while (!readings.done()) {
		await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
	}

	const response = readings.response();
	if (response === NS_MODAL_RESPONSE.cancel) return { paths: [] };
	if (response !== NS_MODAL_RESPONSE.ok) {
		throw new Error(
			`crust: ${command} sheet ended with NSModalResponse ${response}, which is neither ` +
				`OK (${NS_MODAL_RESPONSE.ok}) nor cancel (${NS_MODAL_RESPONSE.cancel})`,
		);
	}

	const count = readings.count();
	if (!Number.isInteger(count) || count < 0 || count > PANEL_MAX_PATHS) {
		throw new Error(
			`crust: ${command} sheet reported ${count} paths, outside 0…${PANEL_MAX_PATHS}`,
		);
	}
	if (count === 0) {
		throw new Error(`crust: ${command} sheet answered OK with no paths`);
	}

	const paths: string[] = [];
	for (let index = 0; index < count; index++) {
		const path = readings.path(index);
		if (path.length === 0) {
			throw new Error(`crust: ${command} sheet answered OK with an empty path at ${index}`);
		}
		paths.push(path);
	}
	return { paths };
}

/**
 * The native half of `crust:dialog` on macOS.
 *
 * `pickOpen` is the plugin's adapter hook; `openPanel` is the same function
 * under the name the plugin's command is called by, so either shape reads
 * correctly at the call site.
 *
 * **The pick does not block while a window is open.** The panel is started as a
 * sheet (`beginSheetModalForWindow:completionHandler:`), the C-side completion
 * handler records the answer, and this adapter awaits it by polling the done
 * flag on a timer — so the JavaScript thread, the Cocoa pump and every in-flight
 * invoke keep running while the sheet is on screen. A sheet needs a window to
 * attach to; with none, the pick falls back to `-runModal`, which does block for
 * the whole pick. That fallback is the only blocking path and is chosen by the
 * shim's `SHIM_PANEL_NO_WINDOW`, never by this adapter guessing.
 *
 * `filters` are applied as extension strings: a filter list is flattened, each
 * entry stripped of a leading `*.` or `.`, de-duplicated, and handed to C as one
 * comma-separated string, because a JS array cannot cross the boundary. macOS 27
 * deprecates `-setAllowedFileTypes:` in favour of `allowedContentTypes` UTType
 * objects, which would be a second object graph inside C; the deprecated setter
 * still works and is guarded like every other selector.
 */

/** Filters as one comma-separated extension list — the only shape C can take. */
export function extensionList(filters: OpenPanelOptions["filters"]): string {
	if (!filters) return "";
	const seen = new Set<string>();
	for (const filter of filters) {
		for (const raw of filter.extensions) {
			const ext = raw
				.trim()
				.replace(/^\*?\.?/, "")
				.toLowerCase();
			if (ext.length > 0) seen.add(ext);
		}
	}
	return [...seen].join(",");
}

export interface DarwinDialogAdapter extends DialogNative {
	openPanel(options: OpenPanelOptions): Promise<OpenPanelResult>;
	savePanel(options: SavePanelOptions): Promise<SavePanelResult>;
}

/** The native reads `awaitSheetResult` polls, bound to the compiled shim. */
function sheetReadings(native: Shim): SheetReadings {
	const symbols = native.symbols;
	return {
		done: () => Number(symbols.shim_sheet_done() ?? 0) === 1,
		response: () => Number(symbols.shim_sheet_response() ?? -1),
		count: () => Number(symbols.shim_open_panel_count() ?? 0),
		path: (index: number) => String(symbols.shim_open_panel_path(index) ?? ""),
	};
}

/** Build the dialog adapter. The shim compiles on the first pick, not before. */
export function darwinDialogAdapter(): DarwinDialogAdapter {
	/** Decode a status the shim answered with synchronously. */
	const immediate = (native: Shim, status: number, command = "openPanel"): OpenPanelResult => {
		if (status === PANEL_STATUS.cancelled) return { paths: [] };
		if (status !== PANEL_STATUS.picked) {
			const name =
				Object.entries(PANEL_STATUS).find(([, value]) => value === status)?.[0] ??
				`status ${status}`;
			const cls = command === "savePanel" ? "NSSavePanel" : "NSOpenPanel";
			throw new Error(`crust: ${command} failed (${name}); ${cls} could not be shown`);
		}

		const count = Number(native.symbols.shim_open_panel_count() ?? 0);
		const paths: string[] = [];
		for (let index = 0; index < count; index++) {
			paths.push(String(native.symbols.shim_open_panel_path(index) ?? ""));
		}
		return { paths };
	};

	const pickOpen = async (options: OpenPanelOptions = {}): Promise<OpenPanelResult> => {
		const native = shim();
		/** One call into `shim_open_panel`; `runModal` picks the sheet or the fallback. */
		const send = (runModal: number): number =>
			Number(
				native.symbols.shim_open_panel(
					cstr(options.title ?? ""),
					cstr(extensionList(options.filters)),
					options.directory ? 1 : 0,
					options.multiple ? 1 : 0,
					runModal,
				) ?? -1,
			);

		// The sheet path first: it returns at once, with the answer to come.
		const sheet = send(0);
		if (sheet === PANEL_STATUS.sheetStarted)
			return await awaitSheetResult(sheetReadings(native), { command: "openPanel" });

		// No window to attach a sheet to, so the only way to show a panel at all
		// is -runModal, which blocks this thread until the user answers.
		if (sheet === PANEL_STATUS.noWindow) return immediate(native, send(1));

		return immediate(native, sheet);
	};

	/**
	 * The save panel, with the same sheet-first flow. AppKit asks before
	 * replacing an existing file; nothing here suppresses that or asks again.
	 */
	const pickSave = async (options: SavePanelOptions = {}): Promise<SavePanelResult> => {
		const native = shim();
		const send = (runModal: number): number =>
			Number(
				native.symbols.shim_save_panel(
					cstr(options.title ?? ""),
					cstr(options.suggestedName ?? ""),
					cstr(extensionList(options.filters)),
					runModal,
				) ?? -1,
			);

		const sheet = send(0);
		if (sheet === PANEL_STATUS.sheetStarted)
			return await awaitSheetResult(sheetReadings(native), { command: "savePanel" });
		if (sheet === PANEL_STATUS.noWindow) return immediate(native, send(1), "savePanel");

		return immediate(native, sheet, "savePanel");
	};

	return { pickOpen, pickSave, openPanel: pickOpen, savePanel: pickSave };
}

// --- window adapter --------------------------------------------------------

/**
 * The native half of `crust:window` on macOS.
 *
 * Built on the `DarwinPlatform` instance the runtime attached, because the
 * labels and the `NSWindow *` pointers already live there. Two facts carry the
 * whole liveness rule:
 *
 *   - `close` sends `-close`, which orders the window out at once. The object
 *     stays addressable because `setReleasedWhenClosed: 0` was applied at
 *     creation, which is what lets the liveness read still work afterwards.
 *   - `isOpen` reads the platform's measured liveness rule, never raw
 *     `-windowNumber`: a closed window keeps its device number (measured), and a
 *     minimised window is not visible yet still open.
 *
 * `focus` orders the window front and activates the app at most once per
 * process through `DarwinPlatform.activateOnce`, so calling it on every switch
 * does not make the Dock icon keep jumping.
 *
 * `create` is `DarwinPlatform.createWindow` and nothing else: that method already
 * builds the `initWithContentRect:` window, adds and pins the webview, applies
 * the title and size, orders it front and tracks the label. The adapter's only
 * jobs are the two facts that method cannot know — whether the label is a live
 * window or a stale closed one, and what "the app's own document" is — and both
 * are read from the platform, never guessed.
 *
 * Every selector here is in `PREFLIGHT`, so a system that cannot do this fails
 * `start()` with a name instead of aborting on an uncaught ObjC exception.
 */
export function darwinWindowAdapter(platform: DarwinPlatform): WindowNative {
	const require = (label: string): number => {
		const win = platform.nativeWindow(label);
		if (win === undefined) {
			throw new WindowAdapterError(
				"unknown-window",
				`crust: no window labelled ${JSON.stringify(label)}`,
			);
		}
		return win;
	};

	/**
	 * The app's own document, as an absolute base URL.
	 *
	 * Neither `CRUST_BRIDGE_URL` nor `.crust/dev.json` is usable here: the runtime
	 * only publishes them when a dev server exists, and a built app runs from `/`
	 * where there is no handshake. What *is* true is that the app's windows were
	 * loaded with that document, and `DarwinPlatform` recorded each one — so the
	 * first tracked window whose URL is a real web URL is the base. A window
	 * loaded as `about:blank` (a caller handed the platform a relative URL) is
	 * skipped, because resolving against it would produce nothing loadable.
	 */
	const documentBase = (): URL => {
		for (const label of platform.windowLabels()) {
			const url = platform.windowUrl(label);
			if (url === undefined || !/^https?:/i.test(url)) continue;
			try {
				return new URL(url);
			} catch {
				continue;
			}
		}
		throw new WindowAdapterError(
			"handler-error",
			"crust: window.create needs an absolute url — no open window has loaded one to resolve against",
		);
	};

	/** Absolute URLs load as given; a relative one joins the app's own document. */
	const resolveDocument = (url: string | undefined): string => {
		if (url !== undefined && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url;
		return new URL(url ?? "/", documentBase()).toString();
	};

	return {
		/**
		 * One `platform.window(label)` call answers both questions at once: a
		 * handle means the label is a live window and must be refused, and
		 * `undefined` means absent *or* closed — and the call has already pruned
		 * the closed entry, which is what stops `createWindow` from refusing a
		 * label nobody can see in `list`. Releasing a closed window is not
		 * replacing an open one: the live case throws before any release.
		 */
		create(options): { label: string } {
			const live = platform.window(options.label);
			if (live !== undefined) {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} is already open`,
				);
			}
			return platform.createWindow({ ...options, url: resolveDocument(options.url) });
		},
		close(label: string): void {
			S.v0(require(label), "close");
		},

		focus(label: string): void {
			S.v1(require(label), "makeKeyAndOrderFront:", 0);
			platform.activateOnce();
		},

		/**
		 * The title is built and applied inside `shim_window_set_title`, because
		 * a short ASCII NSString is a tagged pointer and cannot be marshalled
		 * through bun:ffi. The applied title is read back, so a silent no-op
		 * becomes an error rather than a success.
		 */
		setTitle(label: string, title: string): void {
			const win = require(label);
			shim().symbols.shim_window_set_title(win, cstr(title));
			const applied = String(shim().symbols.shim_window_title_utf8(win) ?? "");
			if (applied !== title) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} title applied as ${JSON.stringify(applied)}`,
				);
			}
		},

		list(): string[] {
			return platform.windowLabels();
		},

		isOpen(label: string): boolean {
			const number = platform.windowNumber(label);
			if (number === undefined) {
				throw new WindowAdapterError(
					"unknown-window",
					`crust: no window labelled ${JSON.stringify(label)}`,
				);
			}
			return number !== 0;
		},
	};
}
