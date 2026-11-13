// micro: per-call overhead of the two artifact-free routes, same process, same machine.
// Route A: a fixed prototype declared to dlopen()      (what the cc() shim replaces)
// Route B: ffi_call with a cif prepared once            (libffi, per-call marshal only)
// Route C: ffi_call + a fresh cif per call              (libffi, no caching)
// All buffers are preallocated; nothing leaks into the measurement.

import { dlopen, read, CFunction } from "bun:ffi";

const LIBFFI = "/usr/lib/libffi.dylib";
const LIBOBJC = "/usr/lib/libobjc.A.dylib";
const LIBSYSTEM = "/usr/lib/libSystem.B.dylib";

const sys = dlopen(LIBSYSTEM, {
	malloc: { args: ["u64"], returns: "ptr" },
	free: { args: ["ptr"], returns: "void" },
	memcpy: { args: ["ptr", "buffer", "u64"], returns: "ptr" },
	dlsym: { args: ["ptr", "cstring"], returns: "ptr" },
	dlopen: { args: ["cstring", "i32"], returns: "ptr" },
});
const alloc = (n: number) => Number(sys.symbols.malloc(n));
const memcpy = sys.symbols.memcpy;
const dlsym = sys.symbols.dlsym;
const ffiHandle = Number(sys.symbols.dlopen(LIBFFI, 1));

const U64 = (v: bigint) => {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, v, true);
	return b;
};
const U32 = (v: number) => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, v, true);
	return b;
};
const U16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
const P = (addr: number, bytes: Uint8Array) => memcpy(addr, bytes, bytes.length);
const hex = (v: number | bigint | null) => (v === null ? "null" : `0x${BigInt(v).toString(16)}`);

const ffi = dlopen(LIBFFI, {
	ffi_prep_cif: { args: ["ptr", "i32", "u32", "ptr", "ptr"], returns: "i32" },
	ffi_call: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" },
});
const t = (name: string) => Number(dlsym(ffiHandle, name));

const T_SINT32 = t("ffi_type_sint32");
const T_POINTER = t("ffi_type_pointer");
const DLSYM_SINT32 = T_SINT32; // same address, kept named for clarity below

// ---------------------------------------------------------------- route A
// abs() declared to dlopen(): the exact shape a .c shim would hand back, minus the shim.
const absLib = dlopen(LIBSYSTEM, { abs: { args: ["i32"], returns: "i32" } });
const absDirect = absLib.symbols.abs;

// A dlsym'd address wrapped in CFunction: fixed prototype at runtime, no source file at all.
const absCFn = new CFunction({ ptr: dlsym(ffiHandle, "abs") ?? dlsym(ffiHandle, "strlen"), args: ["i32"], returns: "i32" });

// ---------------------------------------------------------------- routes B / C
const FFI_DEFAULT_ABI = 1;
const CIF_SIZE = 40;
const ARG_TYPES = alloc(8);
P(ARG_TYPES, U64(BigInt(DLSYM_SINT32)));
const CIF = alloc(CIF_SIZE);
const prep = (cif: number) => {
	P(cif, new Uint8Array(CIF_SIZE));
	P(cif, U32(FFI_DEFAULT_ABI));
	P(cif + 4, U32(1));
	P(cif + 8, U64(BigInt(ARG_TYPES)));
	P(cif + 16, U64(BigInt(DLSYM_SINT32)));
	return ffi.symbols.ffi_prep_cif(cif, FFI_DEFAULT_ABI, 1, DLSYM_SINT32, ARG_TYPES);
};
if (prep(CIF) !== 0) throw new Error("ffi_prep_cif failed");

const AVALUE = alloc(8); // void* avalue[1]
const SLOT = alloc(16); // the int32 storage avalue[0] points at
const RET = alloc(16);
P(AVALUE, U64(BigInt(SLOT)));
const absPtr = Number(dlsym(ffiHandle, "abs"));
if (!absPtr) throw new Error("dlsym(abs) failed");
const callPrepared = () => {
	ffi.symbols.ffi_call(CIF, absPtr, RET, AVALUE);
	return read.i32(RET);
};
const callFresh = () => {
	const cif = alloc(CIF_SIZE);
	prep(cif);
	ffi.symbols.ffi_call(cif, absPtr, RET, AVALUE);
	const v = read.i32(RET);
	sys.symbols.free(cif);
	return v;
};

// ---------------------------------------------------------------- bench
// The box is shared with other agents, so a single pass swings by 5x. Every route is measured in
// the same interleaved round, five rounds, and the MEDIAN is what gets reported.
const N = 500_000;
const REPS = 5;
type Route = { label: string; fn: (i: number) => number };
function timed(fn: (i: number) => number) {
	const t0 = performance.now();
	let sum = 0;
	for (let i = 0; i < N; i++) sum += fn(i);
	return { ns: ((performance.now() - t0) * 1_000_000) / N, sum };
}
const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];

// abs(-42) == 42 for every route, so any route returning 42 is wired right.
// The argument slot is written ONCE, outside every loop: writing it through an FFI memcpy is
// itself a bun:ffi call, and timing it here would bill each route for a marshalling step it does
// not perform (measured separately below — it is ~150-250ns, which swamps the route difference).
P(SLOT, U32(-42));
const routes: Route[] = [
	{ label: "A dlopen fixed prototype (abs)", fn: () => absDirect(-42) },
	{ label: "B ffi_call, cif prepared once", fn: () => callPrepared() },
	{ label: "C ffi_call, cif built per call", fn: () => callFresh() },
	{ label: "D CFunction over a dlsym'd address", fn: () => absCFn(-42) },
];
const samples = new Map<string, number[]>();
const sums = new Map<string, number[]>();
for (const r of routes) {
	for (let i = 0; i < 20_000; i++) r.fn(i); // warm each route once
	samples.set(r.label, []);
	sums.set(r.label, []);
}
for (let rep = 0; rep < REPS; rep++) {
	for (const r of routes) {
		const { ns, sum } = timed(r.fn);
		samples.get(r.label)!.push(ns);
		sums.get(r.label)!.push(sum);
	}
}
const ns = new Map<string, number>();
for (const r of routes) {
	const s = samples.get(r.label)!;
	const ok = sums.get(r.label)!.every((v) => v === 42 * N);
	ns.set(r.label, median(s));
	console.log(`${ok ? "PASS" : "FAIL"}  ${r.label.padEnd(46)} ${median(s).toFixed(1)} ns/call  median of ${REPS}  (${s.map((v) => v.toFixed(0)).join(" ")})`);
}
const a = ns.get(routes[0].label)!;
const b = ns.get(routes[1].label)!;
const c = ns.get(routes[2].label)!;
const d = ns.get(routes[3].label)!;

// struct type graph build cost: elements array + ffi_type, per call. Median of REPS, interleaved
// with the marshal measurement so a busy host hits both equally.
const buildStruct = () => {
	const elems = alloc(24);
	P(elems, U64(BigInt(T_SINT32)));
	P(elems + 8, U64(BigInt(T_SINT32)));
	P(elems + 16, U64(0n));
	const st = alloc(24);
	P(st, U64(8n));
	P(st + 8, U16(4));
	P(st + 10, U16(13));
	P(st + 16, U64(BigInt(elems)));
	sys.symbols.free(elems);
	sys.symbols.free(st);
};
const structSamples: number[] = [];
const writeSamples: number[] = [];
for (let rep = 0; rep < REPS; rep++) {
	const ts = performance.now();
	for (let i = 0; i < 20_000; i++) buildStruct();
	structSamples.push(((performance.now() - ts) * 1_000_000) / 20_000);

	const tw = performance.now();
	for (let i = 0; i < N; i++) P(SLOT, U32(-42));
	writeSamples.push(((performance.now() - tw) * 1_000_000) / N);
}
console.log(`INFO  one 4-byte argument write via memcpy(ptr,buffer,u64)  ${median(writeSamples).toFixed(0)} ns  median of ${REPS}`);
console.log(`INFO  per-call hand-built 8-byte struct type graph   ${median(structSamples).toFixed(0)} ns  median of ${REPS}`);

// The AppKit call shape: (id, SEL, char*) with a cif prepared once — objc_msgSend with one arg.
const three = alloc(24);
P(three, U64(BigInt(T_POINTER)));
P(three + 8, U64(BigInt(T_POINTER)));
P(three + 16, U64(BigInt(T_POINTER)));
const CIF3 = alloc(CIF_SIZE);
P(CIF3, new Uint8Array(CIF_SIZE));
P(CIF3, U32(FFI_DEFAULT_ABI));
P(CIF3 + 4, U32(3));
P(CIF3 + 8, U64(BigInt(three)));
P(CIF3 + 16, U64(BigInt(T_POINTER)));
if (ffi.symbols.ffi_prep_cif(CIF3, FFI_DEFAULT_ABI, 3, T_POINTER, three) !== 0) throw new Error("3-arg prep failed");
const AV3 = alloc(24);
const S3 = alloc(48);
P(AV3, U64(BigInt(S3)));
P(AV3 + 8, U64(BigInt(S3 + 8)));
P(AV3 + 16, U64(BigInt(S3 + 16)));
const RET3 = alloc(16);
const strcmp3 = Number(dlsym(ffiHandle, "strcmp"));
const call3 = () => {
	ffi.symbols.ffi_call(CIF3, strcmp3, RET3, AV3);
	return read.i32(RET3);
};
// two of the three pointers must compare equal for strcmp to return 0; the third is the text.
P(S3, U64(BigInt(S3 + 16)));
P(S3 + 8, U64(BigInt(S3 + 16)));
P(S3 + 16, new TextEncoder().encode("a\0"));
for (let i = 0; i < 20_000; i++) call3();
const threeSamples: number[] = [];
for (let rep = 0; rep < REPS; rep++) threeSamples.push(timed(call3).ns);
console.log(`INFO  3-pointer-arg ffi_call, cif prepared once   ${median(threeSamples).toFixed(0)} ns  median of ${REPS}  (objc_msgSend shape)`);

console.log(`\nSUMMARY  route A ${a.toFixed(0)}ns · route B ${b.toFixed(0)}ns (${(b / a).toFixed(2)}x A) · route C ${c.toFixed(0)}ns · route D ${d.toFixed(0)}ns`);
console.log(`         a full libffi send (marshal + B) ≈ ${(median(writeSamples) + b).toFixed(0)}ns; a cc()-shim send (marshal + A) ≈ ${(median(writeSamples) + a).toFixed(0)}ns`);

process.exit(0);
