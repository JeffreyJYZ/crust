import { ptr } from "bun:ffi";
import { shim } from "./index.ts";

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

export const cstr = (s: string): number => cbuf(s).p;

// A pointer arrives from bun:ffi as an exact number. Anything else is a 64-bit
// integer return (BigInt) or a missing symbol; refuse it rather than coerce it,
// because a mangled pointer faults at 0x10 later on.
export function ptrValue(v: unknown, what: string): number {
	if (typeof v === "number") return v;
	if (v === undefined) throw new Error(`${what} returned undefined`);
	throw new Error(`${what} returned ${typeof v}, not an exact pointer`);
}

const selCache = new Map<string, number>();
export function SEL(name: string): number {
	let s = selCache.get(name);
	if (s === undefined) {
		s = ptrValue(shim().symbols.shim_sel(cstr(name)), `sel_registerName("${name}")`);
		if (s === 0) throw new Error(`sel_registerName("${name}") returned null`);
		selCache.set(name, s);
	}
	return s;
}

const clsCache = new Map<string, number>();
export function cls(name: string): number {
	let c = clsCache.get(name);
	if (c === undefined) {
		c = ptrValue(shim().symbols.shim_cls(cstr(name)), `objc_getClass("${name}")`);
		if (c === 0) throw new Error(`objc_getClass("${name}") is null (framework not linked?)`);
		clsCache.set(name, c);
	}
	return c;
}

// `shim_instance_method` returns a pointer but a null Method is a legitimate
// zero, so it cannot go through ptrValue, which refuses anything but a number.
export function ptrValueZero(v: unknown): number {
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
export const S = {
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

export function allocInit(className: string): number {
	const allocated = S.p0(cls(className), "alloc", true);
	return S.p0(allocated, "init");
}
