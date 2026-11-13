#!/usr/bin/env bun
/**
 * crust M0 spike — the first real window.
 *
 * Run:  bun spike/main.ts
 *
 * Everything native goes through `shim.c`, compiled at launch by `cc()` with
 * AppKit and Foundation linked, because a framework must be linked, not merely
 * dlopened (`objc_getClass("NSWindow")` is null without it and `objc_msgSend`
 * then "works" and returns null). Every objc_msgSend call site in that file
 * uses a FIXED prototype; a plain variadic declaration silently delivers wrong
 * argument values.
 *
 * No struct ever crosses bun:ffi: the window is built with bare `init`, sized
 * by Auto Layout constraints, and geometry is read back one double at a time.
 */

import { cc, FFIType, ptr } from "bun:ffi";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;
const CS = FFIType.cstring;

const tStart = performance.now();
const ms = () => +(performance.now() - tStart).toFixed(1);
const say = (...parts: unknown[]) => console.log(`[${String(ms()).padStart(8)}ms]`, ...parts);

let stepNo = 0;
function stage(name: string) {
	stepNo++;
	say(`--- step ${stepNo}: ${name}`);
	const stop = process.env.CRUST_STOP;
	if (stop && stepNo >= Number(stop)) {
		say(`CRUST_STOP=${stop}: halting here (probe mode)`);
		process.exit(0);
	}
}

// ---------------------------------------------------------------------------
// 1. the shim
// ---------------------------------------------------------------------------

const tCc = performance.now();
const shim = cc({
	source: `${import.meta.dir}/shim.c`,
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
		shim_class_method: { args: [P, P], returns: P },
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

		shim_data: { args: [P, I64], returns: P },
		shim_nsstring_from_data: { args: [P], returns: P },
		shim_length: { args: [P], returns: I64 },
		shim_utf8: { args: [P], returns: CS },
		shim_url_with_string: { args: [P], returns: P },
		shim_request_with_url: { args: [P], returns: P },

		shim_constraint: { args: [P, I64, I64, P, I64, F64, F64], returns: P },
		shim_constraint_simple: { args: [P, I64, I64, F64], returns: P },
		shim_frame_num: { args: [P, I32], returns: F64 },
		shim_window_new: { args: [F64, F64, F64, F64, I64, I64, I32], returns: P },
		shim_webview_load: { args: [P, P], returns: I32 },

		shim_app_load: { args: [], returns: I32 },
		shim_pool_new: { args: [], returns: P },
		shim_pool_init: { args: [P], returns: P },
		shim_pool_drain: { args: [P], returns: V },

		shim_mode: { args: [], returns: P },
		shim_mode_ok: { args: [P], returns: I32 },
		shim_pump: { args: [P], returns: I32 },
	},
});

say(`shim compiled in ${+(performance.now() - tCc).toFixed(1)} ms`);

// C string arguments: cc()-compiled code rejects a JS string, so every
// `const char *` parameter gets an encoded buffer whose bytes stay alive here.
const buffers = new Set<Uint8Array>();
type CBuf = { p: number; len: number };
const cbufCache = new Map<string, CBuf>();
function cbuf(s: string): CBuf {
	let b = cbufCache.get(s);
	if (b === undefined) {
		const bytes = new TextEncoder().encode(`${s}\0`);
		buffers.add(bytes);
		b = { p: ptr(bytes) as unknown as number, len: bytes.length - 1 };
		cbufCache.set(s, b);
	}
	return b;
}
const cstr = (s: string) => cbuf(s).p;

// A pointer arrives from bun:ffi as an exact number. Anything that comes back
// as a BigInt is a 64-bit integer return, never a pointer — refuse it rather
// than coerce it, because a mangled pointer faults at 0x10 later on.
function ptrValue(v: unknown, what: string): number {
	if (typeof v === "number") return v;
	if (v === undefined) throw new Error(`${what} returned undefined`);
	throw new Error(`${what} returned ${typeof v}, not an exact pointer`);
}

const selCache = new Map<string, number>();
function SEL(name: string): number {
	let s = selCache.get(name);
	if (s === undefined) {
		s = ptrValue(shim.symbols.shim_sel(cstr(name)), `sel_registerName("${name}")`);
		if (s === 0) throw new Error(`sel_registerName("${name}") returned null`);
		selCache.set(name, s);
	}
	return s;
}

const clsCache = new Map<string, number>();
function cls(name: string): number {
	let c = clsCache.get(name);
	if (c === undefined) {
		c = ptrValue(shim.symbols.shim_cls(cstr(name)), `objc_getClass("${name}")`);
		if (c === 0) throw new Error(`objc_getClass("${name}") is null (framework not linked?)`);
		clsCache.set(name, c);
	}
	return c;
}

// A string for AppKit, in two measured steps: +[NSData dataWithBytes:length:]
// then -[NSString initWithData:encoding:]. Every C-side alternative failed —
// a C function doing both returned garbage, and so did a CFString built in C
// even with CoreFoundation linked (SIGSEGV at 0x10 on the next use). The length
// argument is a plain number, not a BigInt: that is the shape the probe verified.
const strCache = new Map<string, number>();
function str(text: string): number {
	let o = strCache.get(text);
	if (o === undefined) {
		const b = cbuf(text);
		const data = ptrValue(shim.symbols.shim_data(b.p, b.len), `dataWithBytes:length:(${JSON.stringify(text)})`);
		say(`str(${JSON.stringify(text)}): data object -> ${data}`);
		if (data === 0) throw new Error(`+[NSData dataWithBytes:length:] returned null for ${JSON.stringify(text)}`);
		o = ptrValue(shim.symbols.shim_nsstring_from_data(data), "initWithData:encoding:");
		say(`str(${JSON.stringify(text)}): NSString -> ${o}`);
		if (o === 0) throw new Error(`-[NSString initWithData:encoding:] returned null for ${JSON.stringify(text)}`);
		const got = Number(shim.symbols.shim_length(o) ?? -1);
		say(`str(${JSON.stringify(text)}): length -> ${got} (want ${text.length})`);
		if (got !== text.length) throw new Error(`NSString round-trip failed for ${JSON.stringify(text)}: length ${got}`);
		strCache.set(text, o);
	}
	return o;
}

// ---------------------------------------------------------------------------
// 2. the guard
// ---------------------------------------------------------------------------
//
// An uncaught Objective-C exception terminates the whole process with SIGABRT
// and no JavaScript error (`+[NSObject(NSObject) doesNotRecognizeSelector:]`),
// so nothing is sent on faith. Each (receiver class, selector) pair is checked
// once and its result printed: `respondsToSelector:` against the actual
// receiver, plus a Method lookup on the receiver's class.

const guardLines: string[] = [];
const guardCache = new Map<string, boolean>();
let guardPass = 0;
let guardFail = 0;

function check(recv: number, name: string, asClass = false): boolean {
	if (!recv) throw new Error(`guard(${name}): receiver is null`);
	const meta = Number(shim.symbols.shim_object_class(recv) ?? 0);
	const dyn = String(shim.symbols.shim_class_name(recv) ?? "?");
	const owner = asClass ? String(shim.symbols.shim_name_of_class(recv) ?? "?") : dyn;
	const key = `${asClass ? "+" : "-"}[${asClass ? owner : dyn} ${name}]`;
	const cached = guardCache.get(key);
	if (cached !== undefined) return cached;

	const s = SEL(name);
	const responds = Number(shim.symbols.shim_responds(recv, s) ?? 0) === 1;
	const method =
		Number(
			(asClass
				? shim.symbols.shim_class_method(recv, s)
				: shim.symbols.shim_instance_method(meta, s)) ?? 0,
		) !== 0;
	const ok = responds && method;
	guardCache.set(key, ok);
	if (ok) guardPass++;
	else guardFail++;
	const line = `${ok ? "PASS" : "FAIL"} guard ${key}  respondsToSelector=${responds ? 1 : 0} method=${method ? 1 : 0}`;
	guardLines.push(line);
	say(line);
	return ok;
}

function must(recv: number, name: string, asClass = false) {
	if (!check(recv, name, asClass)) throw new Error(`refused to send ${name}: guard failed`);
}

// Every send goes through exactly one of these, and each one guards first.
const S = {
	p0: (r: number, n: string, c = false) => (must(r, n, c), ptrValue(shim.symbols.shim_send_p0(r, SEL(n)), n)),
	p1: (r: number, n: string, a: number) => (must(r, n), ptrValue(shim.symbols.shim_send_p1(r, SEL(n), a), n)),
	p2: (r: number, n: string, a: number, b: number) => (must(r, n), ptrValue(shim.symbols.shim_send_p2(r, SEL(n), a, b), n)),
	p3: (r: number, n: string, a: number, b: number, d: number) => (must(r, n), ptrValue(shim.symbols.shim_send_p3(r, SEL(n), a, b, d), n)),
	pq1: (r: number, n: string, v: number | bigint) => (must(r, n), ptrValue(shim.symbols.shim_send_pq1(r, SEL(n), typeof v === "bigint" ? v : BigInt(v)), n)),
	pd1: (r: number, n: string, v: number) => (must(r, n), ptrValue(shim.symbols.shim_send_pd1(r, SEL(n), v), n)),
	pb1: (r: number, n: string, v: number) => (must(r, n), ptrValue(shim.symbols.shim_send_pb1(r, SEL(n), v), n)),
	b0: (r: number, n: string) => (must(r, n), Number(shim.symbols.shim_send_b0(r, SEL(n)) ?? 0) !== 0),
	b1: (r: number, n: string, a: number) => (must(r, n), Number(shim.symbols.shim_send_b1(r, SEL(n), a) ?? 0) !== 0),
	q0: (r: number, n: string) => (must(r, n), Number(shim.symbols.shim_send_q0(r, SEL(n)) ?? 0)),
	v0: (r: number, n: string) => (must(r, n), shim.symbols.shim_send_v0(r, SEL(n))),
	v1: (r: number, n: string, a: number) => (must(r, n), shim.symbols.shim_send_v1(r, SEL(n), a)),
	v2: (r: number, n: string, a: number, b: number) => (must(r, n), shim.symbols.shim_send_v2(r, SEL(n), a, b)),
	vb1: (r: number, n: string, v: number) => (must(r, n), shim.symbols.shim_send_vb1(r, SEL(n), v)),
	vq1: (r: number, n: string, v: number | bigint) => (must(r, n), shim.symbols.shim_send_vq1(r, SEL(n), typeof v === "bigint" ? v : BigInt(v))),
	vd1: (r: number, n: string, v: number) => (must(r, n), shim.symbols.shim_send_vd1(r, SEL(n), v)),
};

function allocInit(className: string): number {
	const allocated = S.p0(cls(className), "alloc", true);
	return S.p0(allocated, "init");
}

function frameNum(view: number, component: 0 | 1 | 2 | 3): number {
	return +Number(shim.symbols.shim_frame_num(view, component)).toFixed(1);
}

// ---------------------------------------------------------------------------
// 3. guard preflight for the sends the shim makes internally
// ---------------------------------------------------------------------------
//
// shim.c sends a handful of selectors itself (string building, KVC, constraint
// construction). Those cannot be guarded from JavaScript, so each one is
// checked here, once, before any of them can run.

stage("guard preflight");
const preflight: Array<[string, string, boolean]> = [
	["NSData", "dataWithBytes:length:", true],
	["NSString", "initWithData:encoding:", false],
	["NSLayoutConstraint", "constraintWithItem:attribute:relatedBy:constant:", true],
	["NSView", "valueForKey:", false],
	["NSValue", "getValue:", false],
];
for (const [owner, name, isClass] of preflight) {
	const target = isClass ? cls(owner) : cls(owner);
	// An instance lookup on the class is the honest test for an instance send.
	const responds = isClass
		? Number(shim.symbols.shim_responds(target, SEL(name)) ?? 0) === 1
		: Number(shim.symbols.shim_instance_method(target, SEL(name)) ?? 0) !== 0;
	say(`${responds ? "PASS" : "FAIL"} preflight ${isClass ? "+" : "-"}[${owner} ${name}]  ${isClass ? "respondsToSelector" : "class_getInstanceMethod"}=${responds ? 1 : 0}`);
	if (!responds) throw new Error(`refusing to run: ${owner} does not implement ${name}`);
}

// ---------------------------------------------------------------------------
// 4. application
// ---------------------------------------------------------------------------

stage("NSApplicationLoad");
const tLoad = performance.now();
const loaded = Number(shim.symbols.shim_app_load() ?? 0);
say(`NSApplicationLoad -> ${loaded} in ${+(performance.now() - tLoad).toFixed(1)} ms`);
if (!loaded) throw new Error("NSApplicationLoad returned false");

const NSApplication = cls("NSApplication");
const NSApp = S.p0(NSApplication, "sharedApplication", true);
say(`NSApplication sharedApplication -> ${NSApp}`);
const policySet = S.pq1(NSApp, "setActivationPolicy:", 0);
say(`setActivationPolicy:0 -> ${policySet}; activationPolicy reads back ${S.q0(NSApp, "activationPolicy")}`);
S.v0(NSApp, "finishLaunching");
say("finishLaunching sent (documented idempotent; not a precondition for the pump)");

// ---------------------------------------------------------------------------
// 5. window — bare init, no initWithContentRect:, no setFrame:
// ---------------------------------------------------------------------------

stage("NSWindow alloc + init");
const tWindow = performance.now();
const NSWindowCls = cls("NSWindow");
const win = Number(shim.symbols.shim_window_new(120, 120, 1100, 760, 15n, 2n, 0));
say(`window -> ${win} (initWithContentRect:styleMask:backing:defer:, ${+(performance.now() - tWindow).toFixed(2)} ms)`);
if (!win) throw new Error("[[NSWindow alloc] init] returned null");

S.vb1(win, "setReleasedWhenClosed:", 0);
// titled(1) | closable(2) | miniaturizable(4) | resizable(8). A borderless
// window (styleMask 0) has no titlebar, and setTitle: on it is not a fair test
// of setTitle: — so the mask goes on before the title.
S.vq1(win, "setStyleMask:", 15n);
say(`setStyleMask:15 -> styleMask reads back ${S.q0(win, "styleMask")} (want 15)`);

// Title omitted from M0: a short ASCII NSString is a tagged pointer, so the
// object cannot cross bun:ffi and no title is set here.
say(`title omitted; isVisible=${S.b0(win, "isVisible") ? 1 : 0} before ordering front`);

// ---------------------------------------------------------------------------
// 6. webview — bare init, geometry from constraints
// ---------------------------------------------------------------------------

stage("WKWebView alloc + init");
const web = allocInit("WKWebView");
say(`webview -> ${web}`);
if (!web) throw new Error("[[WKWebView alloc] init] returned null");
say(`webview configuration -> ${S.p0(web, "configuration")}; isLoading=${S.b0(web, "isLoading") ? 1 : 0}`);

const content = S.p0(win, "contentView");
say(`window contentView -> ${content} (${String(shim.symbols.shim_class_name(content))})`);
if (!content) throw new Error("-[NSWindow contentView] returned null");

const tLayout = performance.now();
S.v1(content, "addSubview:", web);
S.vb1(web, "setTranslatesAutoresizingMaskIntoConstraints:", 0);
S.vb1(content, "setTranslatesAutoresizingMaskIntoConstraints:", 0);

const NSLayoutConstraintCls = cls("NSLayoutConstraint");
const preConstraints = [
	String(shim.symbols.shim_constraint(web, 5n, 0n, content, 5n, 1, 0)), // leading == leading
	String(shim.symbols.shim_constraint(web, 6n, 0n, content, 6n, 1, 0)), // trailing == trailing
	String(shim.symbols.shim_constraint(web, 3n, 0n, content, 3n, 1, 0)), // top == top
	String(shim.symbols.shim_constraint(web, 4n, 0n, content, 4n, 1, 0)), // bottom == bottom
];
const cWidth = Number(shim.symbols.shim_constraint_simple(web, 7n, 0n, 1100));
const cHeight = Number(shim.symbols.shim_constraint_simple(web, 8n, 0n, 760));
for (const c of [...preConstraints.map(Number), cWidth, cHeight]) {
	if (!c) throw new Error("constraintWithItem: returned null");
	// -[NSLayoutConstraint setActive:] is an instance method (v20@0:8B16).
	S.vb1(c, "setActive:", 1);
}
say(`6 constraints created and activated in ${+(performance.now() - tLayout).toFixed(2)} ms (width=${cWidth}, height=${cHeight})`);

// ---------------------------------------------------------------------------
// 7. show the window
// ---------------------------------------------------------------------------

stage("order front");
S.v1(win, "makeKeyAndOrderFront:", 0); // nil
S.vb1(NSApp, "activateIgnoringOtherApps:", 1);
const visibleNow = S.b0(win, "isVisible");
say(`window ordered front; isVisible=${visibleNow ? 1 : 0}; styleMask=${S.q0(win, "styleMask")}`);

// ---------------------------------------------------------------------------
// 8. serve the page, then load it in the webview
// ---------------------------------------------------------------------------

const tServe = performance.now();
let pageFacts: Record<string, unknown> | null = null;
let pageFirstLineAt = 0;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>crust M0</title></head>
<body style="margin:0;background:#0b0b0c;color:#e7e7ea;font:13px ui-monospace,SFMono-Regular,monospace">
<pre id="out" style="padding:18px;white-space:pre-wrap">crust M0 — page script running…</pre>
<script>
const facts = { pageNow: +performance.now().toFixed(1), timeOrigin: +performance.timeOrigin.toFixed(1),
                vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
                ua: navigator.userAgent, href: location.href };
document.title = "loaded@" + facts.pageNow + "ms";
const out = document.getElementById("out");
out.textContent = "crust M0\\n" + JSON.stringify(facts, null, 2);
fetch("/report?d=" + encodeURIComponent(JSON.stringify(facts)), { method: "POST" })
  .then(() => { out.textContent += "\\nreport accepted"; })
  .catch((e) => { out.textContent += "\\nreport failed: " + e; });
</script></body></html>`;

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/report") {
			const raw = url.searchParams.get("d") ?? "{}";
			pageFirstLineAt = performance.now();
			try {
				pageFacts = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				pageFacts = { raw };
			}
			onPageReport();
			return new Response("ok");
		}
		if (url.pathname === "/") {
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		}
		return new Response("not found", { status: 404 });
	},
});
const port = server.port;
stage("server up");
say(`Bun.serve on 127.0.0.1:${port} in ${+(performance.now() - tServe).toFixed(2)} ms`);

stage("loadRequest:");
const urlString = `http://localhost:${port}/`;
const loadOk = Number(shim.symbols.shim_webview_load(web, cstr(urlString)) ?? 0);
if (!loadOk) throw new Error(`shim_webview_load failed for ${urlString}`);
say(`loadRequest: ${urlString} -> sent entirely in C (isLoading=${S.b0(web, "isLoading") ? 1 : 0})`);

// ---------------------------------------------------------------------------
// 9. pump the Cocoa run loop from JavaScript
// ---------------------------------------------------------------------------

stage("pump");
const mode = Number(shim.symbols.shim_mode() ?? 0);
const modeOk = Number(shim.symbols.shim_mode_ok(mode) ?? 0) === 1;
say(`CFString for kCFRunLoopDefaultMode = ${mode} (content-verified: ${modeOk ? "yes" : "NO"})`);
if (!modeOk) throw new Error("run loop mode string did not verify — a wrong mode is a silent no-op");

const TICK_MS = 16; // 16 ms tick
const SLICE = 0.00025; // 0.25 ms slice, inside shim_pump()
let ticks = 0;
let pumpMs = 0;
let lastTick = performance.now();
let worstGap = 0;
let windowWasVisible = S.b0(win, "isVisible");
let firstVisibleAt = windowWasVisible ? performance.now() - tWindow : -1;
let resized = 0;
let lastResizeAt = -1;

function tick() {
	const t = performance.now();
	const gap = t - lastTick;
	if (gap > worstGap) worstGap = gap;
	lastTick = t;

	const tPump = performance.now();
	shim.symbols.shim_pump(mode);
	pumpMs += performance.now() - tPump;
	ticks++;

	const visible = S.b0(win, "isVisible");
	if (visible && firstVisibleAt < 0) firstVisibleAt = t - tWindow;
	if (windowWasVisible && !visible) {
		finish("window closed (isVisible went false)");
		return;
	}

	const alive = t - tWindow;
	if (pageFirstLineAt && alive > 4000 && resized === 0) {
		resized = 1;
		lastResizeAt = t - pageFirstLineAt;
		say(`resize #1 at page+${lastResizeAt.toFixed(0)} ms: width constraint 1100 -> 900`);
		S.vd1(cWidth, "setConstant:", 900);
	}
	if (pageFirstLineAt && alive > 8000 && resized === 1) {
		resized = 2;
		lastResizeAt = t - pageFirstLineAt;
		say(`resize #2 at page+${lastResizeAt.toFixed(0)} ms: width constraint 900 -> 1100`);
		S.vd1(cWidth, "setConstant:", 1100);
	}
	if (alive > 30000) {
		finish("30 s alive, exiting normally");
		return;
	}
	setTimeout(tick, TICK_MS);
}

// ---------------------------------------------------------------------------
// 10. evidence, resize, exit
// ---------------------------------------------------------------------------

function onPageReport() {
	const fromWindow = +(pageFirstLineAt - tWindow).toFixed(1);
	say(`PAGE REPORT received ${fromWindow} ms after window creation`);
	if (pageFacts) say(`page facts: ${JSON.stringify(pageFacts)}`);

	const titlePtr = S.p0(web, "title");
	say(`-[WKWebView title] -> ${JSON.stringify(String(shim.symbols.shim_utf8(titlePtr) ?? ""))} (the page set it itself)`);
	say(`-[WKWebView isLoading] -> ${S.b0(web, "isLoading") ? 1 : 0}`);

	// The one risky read: KVC on a view whose window was created with bare
	// `init`. A bare-init NSWindow traps on valueForKey:@"frame" (measured),
	// which is why this runs only after the page has already loaded.
	say("reading webview frame via KVC (NSValue -> getValue: inside C, one double at a time)");
	say(`webview frame = ${frameNum(web, 0)},${frameNum(web, 1)} ${frameNum(web, 2)}x${frameNum(web, 3)}`);
	const screen = S.p0(win, "screen");
	say(`-[NSWindow screen] -> ${screen} (non-null means the window frame overlaps a screen)`);
}

let finished = false;
function finish(reason: string) {
	if (finished) return;
	finished = true;
	say(`FINISH: ${reason}`);
	say(
		`window: created at t=0, first isVisible ${firstVisibleAt >= 0 ? `${firstVisibleAt.toFixed(1)} ms` : "never"}; ` +
			`page first line ${pageFirstLineAt ? `+${(pageFirstLineAt - tWindow).toFixed(1)} ms after window creation` : "NEVER ARRIVED"}; ` +
			`resizes survived: ${resized}`,
	);
	say(
		`pump: ${ticks} ticks, ${+pumpMs.toFixed(1)} ms total in CFRunLoopRunInMode, mean ${+(pumpMs / Math.max(1, ticks)).toFixed(3)} ms, worst tick gap ${+worstGap.toFixed(1)} ms`,
	);
	say(`guards: ${guardPass} pass / ${guardFail} fail over ${guardCache.size} (class, selector) pairs`);
	say(rssReport());
	try {
		server.stop(true);
	} catch {}
	process.exit(0);
}

function rssReport(): string {
	const out = Bun.spawnSync(["ps", "-Ao", "pid=,ppid=,rss=,comm="]);
	const text = new TextDecoder().decode(out.stdout as Uint8Array);
	type Row = { pid: number; ppid: number; rss: number; comm: string };
	const rows: Row[] = [];
	for (const line of text.split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
		if (m) rows.push({ pid: +m[1], ppid: +m[2], rss: +m[3], comm: m[4] });
	}
	const self = rows.find((r) => r.pid === process.pid);
	const tree: Row[] = [];
	const queue = [process.pid];
	while (queue.length) {
		const parent = queue.shift()!;
		for (const r of rows) {
			if (r.ppid === parent && !tree.some((x) => x.pid === r.pid)) {
				tree.push(r);
				queue.push(r.pid);
			}
		}
	}
	const helpers = rows.filter(
		(r) =>
			/com\.apple\.WebKit/.test(r.comm) && !tree.some((x) => x.pid === r.pid) && r.pid !== process.pid,
	);
	const mb = (kb: number) => +(kb / 1024).toFixed(1);
	const own = self ? self.rss : 0;
	const lineage = tree.reduce((a, r) => a + r.rss, 0);
	const webkit = helpers.reduce((a, r) => a + r.rss, 0);
	const lines = [
		`RSS self ${mb(own)} MB; descendants ${tree.length} (${mb(lineage)} MB); WebKit helpers outside the tree ${helpers.length} (${mb(webkit)} MB); group total ${mb(own + lineage + webkit)} MB`,
	];
	for (const r of [...tree, ...helpers]) lines.push(`  · ${r.pid} rss=${mb(r.rss)}MB ${r.comm}`);
	return lines.join("\n");
}

process.on("SIGINT", () => finish("SIGINT"));
process.on("SIGTERM", () => finish("SIGTERM"));

stage("start pump loop");
say(`pumping CFRunLoopRunInMode(mode, ${SLICE}, true) every ${TICK_MS} ms from a setTimeout chain`);
tick();

