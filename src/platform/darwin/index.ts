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
import type { DialogNative, OpenPanelOptions, OpenPanelResult } from "@/plugins/dialog";

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
			shim_window_set_title: { args: [P, P], returns: V },
			shim_window_title_utf8: { args: [P], returns: CS },

			shim_app_load: { args: [], returns: I32 },
			shim_pool_new: { args: [], returns: P },
			shim_pool_init: { args: [P], returns: P },
			shim_pool_drain: { args: [P], returns: V },

			shim_mode: { args: [], returns: P },
			shim_mode_ok: { args: [P], returns: I32 },
			shim_pump: { args: [P], returns: I32 },

			// The open panel: an int status in, and the chosen paths read back
			// one at a time as C strings. No object and no struct crosses.
			shim_open_panel: { args: [P, I32, I32, I32], returns: I32 },
			shim_open_panel_count: { args: [], returns: I32 },
			shim_open_panel_path: { args: [I32], returns: CS },
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
		shim_window_set_title: LooseSymbol;
		shim_window_title_utf8: LooseSymbol;

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
	["NSWindow", "windowNumber"],
	["WKWebView", "init"],
	["WKWebView", "loadRequest:"],
	["NSApplication", "setActivationPolicy:"],
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
];

const internalInstanceSelectors: ReadonlyArray<readonly [string, string]> = [
	// NSString is a class cluster: +alloc yields an NSPlaceholderString, and that
	// concrete class is where -initWithBytes:length:encoding: is implemented.
	["NSPlaceholderString", "initWithBytes:length:encoding:"],
	["NSWindow", "valueForKey:"],
	["NSValue", "getValue:"],
	["NSView", "valueForKey:"],
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

		// A closed window must stay addressable: -windowNumber reads 0 once it
		// has closed, and that is the liveness test window(label) uses.
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
		if (this.#app) {
			try {
				S.vb1(this.#app, "activateIgnoringOtherApps:", 1);
			} catch {
				// Activation is cosmetic; a failure must not lose the window.
			}
		}

		// A relative URL needs the bridge server, which the platform does not own;
		// only an absolute URL can be handed to NSURL as-is.
		const raw = options.url ?? "/";
		const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : "about:blank";
		const loaded = Number(shim().symbols.shim_webview_load(web, cstr(url)) ?? 0);
		if (!loaded) throw new Error(`shim_webview_load failed for ${url}`);

		const handle: WindowHandle = { label };
		this.#windows.set(label, { handle, win, web });
		return handle;
	}

	/**
	 * Return the handle only while the window is alive. `-windowNumber` reads 0
	 * once it has closed; `isVisible` is not a liveness test, because a minimised
	 * window is not visible but is still open.
	 */
	window(label: string): WindowHandle | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (S.q0(entry.win, "windowNumber") === 0) {
			this.#windows.delete(label);
			return undefined;
		}
		return entry.handle;
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
export function createPlatform(options: { appName?: string } = {}): Platform {
	return new DarwinPlatform(options);
}

// --- dialog adapter --------------------------------------------------------

/**
 * What `shim_open_panel` returns. Mirrors the `SHIM_PANEL_*` defines in
 * `shim.c`; the shim guards every selector itself and reports an absent one as
 * `unsupported` rather than sending it and aborting the process.
 */
export const PANEL_STATUS = {
	/** A modal pick finished with at least one path. */
	picked: 0,
	/** A modal pick finished with no path — the user cancelled. */
	cancelled: 1,
	/** `NSOpenPanel`, or a selector it needs, is absent on this system. */
	unsupported: 2,
	/** The sheet is on screen. Nothing in this adapter ever observes its result. */
	sheetStarted: 3,
	/** A sheet was asked for with no key window; nothing was sent. */
	noWindow: 4,
} as const;

/**
 * The native half of `crust:dialog` on macOS.
 *
 * `pickOpen` is the plugin's adapter hook; `openPanel` is the same function
 * under the name the plugin's command is called by, so either shape reads
 * correctly at the call site.
 *
 * **The pick blocks.** `-runModal` enters AppKit's own run loop and does not
 * return until the user answers, so this Promise is already settled by the time
 * it resolves — the JavaScript thread, and with it the Cocoa pump and every
 * in-flight invoke, is stopped for as long as the panel is on screen. That is
 * the accepted cost of a real file picker in v1 (DESIGN.md §9, item 7), stated
 * rather than disguised as non-blocking work.
 *
 * `filters` is not applied: it needs an `allowedContentTypes` array of UTType
 * objects, which is a second object graph inside C and is not implemented here.
 * The paths come back, the filter does not.
 */
export interface DarwinDialogAdapter extends DialogNative {
	openPanel(options: OpenPanelOptions): Promise<OpenPanelResult>;
}

/** Build the dialog adapter. The shim compiles on the first pick, not before. */
export function darwinDialogAdapter(): DarwinDialogAdapter {
	const pickOpen = async (options: OpenPanelOptions = {}): Promise<OpenPanelResult> => {
		const native = shim();
		const status = Number(
			native.symbols.shim_open_panel(
				cstr(options.title ?? ""),
				options.directory ? 1 : 0,
				options.multiple ? 1 : 0,
				1,
			) ?? 0,
		);

		if (status === PANEL_STATUS.cancelled) return { paths: [] };
		if (status !== PANEL_STATUS.picked) {
			const name =
				Object.entries(PANEL_STATUS).find(([, value]) => value === status)?.[0] ??
				`status ${status}`;
			throw new Error(`crust: openPanel failed (${name}); NSOpenPanel could not be shown`);
		}

		const count = Number(native.symbols.shim_open_panel_count() ?? 0);
		const paths: string[] = [];
		for (let index = 0; index < count; index++) {
			paths.push(String(native.symbols.shim_open_panel_path(index) ?? ""));
		}
		return { paths };
	};

	return { pickOpen, openPanel: pickOpen };
}
