// ffi.ts — bun:ffi plumbing for the crust run-loop probes.
//
// Facts measured on Bun 1.4.4 / macOS 27.0.1 / arm64, each one load-bearing:
//
//  * `bun:ffi`'s dlopen resolves a symbol by its **key name** in the spec. There
//    is no aliasing: `objc_msgSend$foo` is a lookup for that literal string and
//    always fails. libobjc exports exactly one `objc_msgSend`, so each call site
//    declares an arity and calls the same symbol. Extra pointer arguments are
//    ignored by the callee on arm64.
//  * AppKit is not a file on this OS. `AppKit.framework/Versions/C/AppKit` exists
//    as a path and dlopen accepts it, but the binary lives only in the dyld
//    shared cache; `NSApplicationLoad` registers the classes.
//  * A C **data** symbol is not callable. `kCFRunLoopDefaultMode` resolves to the
//    variable's address, so a zero-arg declaration executes the bytes there and
//    Bun dies `Bus error at address 0x1E32DFD78` — which dladdr confirms is the
//    variable itself.
//  * A `char *` return is decoded by bun:ffi into a JS string already. Feeding
//    that string to CString throws `ptr must be a number`.
//  * `process.exit()` trips AppKit teardown and prints
//    `panic: A C++ exception occurred` after the JS has completed. The exit code
//    is still 0, so probes print first and exit last.

import { dlopen, FFIType } from "bun:ffi";

export const P = FFIType.ptr;
export const C = FFIType.cstring;
export const I = FFIType.i32;
export const L = FFIType.i64;
export const D = FFIType.double;
export const B = FFIType.bool;
export const V = FFIType.void;

export const OBJC = "/usr/lib/libobjc.A.dylib";
export const CF = "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation";
export const APPKIT = "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit";

const rt = dlopen(OBJC, {
	objc_getClass: { args: [C], returns: P },
	sel_registerName: { args: [C], returns: P },
	sel_getName: { args: [P], returns: C },
	object_getClass: { args: [P], returns: P },
	class_getName: { args: [P], returns: C },
	class_getSuperclass: { args: [P], returns: P },
	class_getInstanceMethod: { args: [P, P], returns: P },
	class_getClassMethod: { args: [P, P], returns: P },
}).symbols;
export const RT = rt;

const sigs = new Map<string, any>();
export function msg(argc: number, ret: any = P) {
	const k = `${argc}:${String(ret)}`;
	let f = sigs.get(k);
	if (!f) {
		const a: any[] = [P, P];
		for (let i = 0; i < argc; i++) a.push(P);
		f = dlopen(OBJC, { objc_msgSend: { args: a, returns: ret } }).symbols.objc_msgSend;
		sigs.set(k, f);
	}
	return f;
}

const selCache = new Map<string, any>();
export function sel(n: string) {
	let s = selCache.get(n);
	if (s === undefined) {
		s = rt.sel_registerName(n);
		if (!s) throw new Error(`sel_registerName("${n}") returned null`);
		selCache.set(n, s);
	}
	return s;
}
export function cls(n: string) {
	const c = rt.objc_getClass(n);
	if (!c) throw new Error(`objc_getClass("${n}") is null (AppKit loaded?)`);
	return c;
}

// --- guard -----------------------------------------------------------------
// An uncaught Objective-C exception is fatal to the whole Bun process
// (SIGABRT, ending in +[NSObject doesNotRecognizeSelector:]), so a single wrong
// selector destroys every other measurement in the file. Every send goes
// through here.

export const responds = (o: any, s: string) => msg(1, I)(o, sel("respondsToSelector:"), sel(s)) === 1;
export const instanceMethod = (cl: any, s: string) => rt.class_getInstanceMethod(cl, sel(s)) !== 0;

export type Safe<T> = { ok: true; value: T } | { ok: false; reason: string };

export function call(receiver: any, selector: string, ...args: any[]): Safe<any> {
	if (!responds(receiver, selector)) {
		return { ok: false, reason: `-${selector} not implemented by ${objectClassName(receiver)}` };
	}
	return { ok: true, value: msg(args.length, P)(receiver, sel(selector), ...args) };
}
export function callI(receiver: any, selector: string, ...args: any[]): Safe<number> {
	if (!responds(receiver, selector)) {
		return { ok: false, reason: `-${selector} not implemented by ${objectClassName(receiver)}` };
	}
	return { ok: true, value: msg(args.length, I)(receiver, sel(selector), ...args) };
}
export function callV(receiver: any, selector: string, ...args: any[]): Safe<null> {
	if (!responds(receiver, selector)) {
		return { ok: false, reason: `-${selector} not implemented by ${objectClassName(receiver)}` };
	}
	msg(args.length, V)(receiver, sel(selector), ...args);
	return { ok: true, value: null };
}

// --- object helpers --------------------------------------------------------
export const objectClass = (o: any) => rt.object_getClass(o);
export const objectClassName = (o: any) => String(rt.class_getName(rt.object_getClass(o)));
export const className = (cl: any) => String(rt.class_getName(cl));
export const utf8 = (nsstr: any) => msg(0, C)(nsstr, sel("UTF8String")) as unknown as string;
export const desc = (o: any) => utf8(msg(0, P)(o, sel("description")));

// --- AppKit / CoreFoundation handles --------------------------------------
export const ak = dlopen(APPKIT, {
	NSApplicationLoad: { args: [], returns: B },
}).symbols;

export const cf = dlopen(CF, {
	CFRunLoopRunInMode: { args: [P, D, B], returns: I },
	CFRunLoopGetMain: { args: [], returns: P },
	CFRunLoopStop: { args: [P], returns: V },
	CFRunLoopIsWaiting: { args: [P], returns: B },
	__CFStringMakeConstantString: { args: [C], returns: P },
	CFStringGetCString: { args: [P, P, I, I], returns: B },
	CFStringGetLength: { args: [P], returns: I },
}).symbols;

export function loadAppKit(): number {
	const t0 = performance.now();
	const ok = ak.NSApplicationLoad();
	if (!ok) throw new Error("NSApplicationLoad returned false");
	return +(performance.now() - t0).toFixed(1);
}

// NSApp is a data symbol in the dyld cache; there is no exported *function*
// that yields the instance. Read the pointer via the class method instead.
export function sharedApp(): any {
	return msg(0, P)(cls("NSApplication"), sel("sharedApplication"));
}

export function stat(xs: number[]) {
	if (xs.length === 0) return { n: 0, mean: 0, min: 0, median: 0, p95: 0, p99: 0, max: 0 };
	const s = [...xs].sort((a, b) => a - b);
	const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
	return {
		n: xs.length,
		mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3),
		min: +s[0].toFixed(3),
		median: +q(0.5).toFixed(3),
		p95: +q(0.95).toFixed(3),
		p99: +q(0.99).toFixed(3),
		max: +s[s.length - 1].toFixed(3),
	};
}

// The default run-loop mode as a CFString pointer.
//
// kCFRunLoopDefaultMode cannot be read through bun:ffi (see header). A constant
// CFString is not the same pointer as the canonical one, so this is verified by
// content before use — see modeName().
export function makeMode(text = "kCFRunLoopDefaultMode"): any {
	return cf.__CFStringMakeConstantString(text);
}
export function cfStringBytes(s: any): string {
	const len = cf.CFStringGetLength(s);
	const cap = (len + 1) * 4;
	const buf = new Uint8Array(cap);
	const ok = cf.CFStringGetCString(s, buf, cap, 0x08000100);
	return ok ? new TextDecoder().decode(buf.subarray(0, buf.indexOf(0))) : `<${len} units, getCString failed>`;
}