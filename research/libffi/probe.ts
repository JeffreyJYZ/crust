// probe: can libffi be driven from `bun:ffi` alone, on macOS arm64, with no compiled artifact?
// One PASS/FAIL line per check, each with its evidence. Always exits.

import { dlopen, read } from "bun:ffi";

const LIBFFI = "/usr/lib/libffi.dylib";
const LIBOBJC = "/usr/lib/libobjc.A.dylib";
const LIBSYSTEM = "/usr/lib/libSystem.B.dylib";
const FOUNDATION = "/System/Library/Frameworks/Foundation.framework/Foundation";

let failures = 0;
function fmt(v: unknown): string {
	if (typeof v === "bigint") return `${v}n`;
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
	if (v instanceof Uint8Array) return `[${Array.from(v).join(",")}]`;
	try {
		return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
	} catch {
		return String(v);
	}
}
const ok = (label: string, evidence: unknown) => console.log(`PASS  ${label} :: ${fmt(evidence)}`);
const bad = (label: string, evidence: unknown) => {
	failures++;
	console.log(`FAIL  ${label} :: ${fmt(evidence)}`);
};
function check(label: string, fn: () => unknown) {
	try {
		const v = fn();
		ok(label, v);
		return v;
	} catch (e) {
		bad(label, e instanceof Error ? e.message : String(e));
		return undefined;
	}
}

// ---------------------------------------------------------------- primitives
// libSystem is the source of malloc/free/memcpy, and of dlopen/dlsym for raw symbol lookup.
const sys = dlopen(LIBSYSTEM, {
	malloc: { args: ["u64"], returns: "ptr" },
	free: { args: ["ptr"], returns: "void" },
	memcpy: { args: ["ptr", "buffer", "u64"], returns: "ptr" },
	dlopen: { args: ["cstring", "i32"], returns: "ptr" },
	dlsym: { args: ["ptr", "cstring"], returns: "ptr" },
});
const M = sys.symbols.malloc;
const memcpy = sys.symbols.memcpy;
const dlsym = sys.symbols.dlsym;
const dlopenRaw = sys.symbols.dlopen;

const ALLOCS: number[] = [];
const A = (n: number): number => {
	const p = Number(M(n));
	if (!p) throw new Error(`malloc(${n}) returned NULL`);
	ALLOCS.push(p);
	return p;
};
const P = (addr: number, bytes: Uint8Array) => memcpy(addr, bytes, bytes.length);
const U16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
const U32 = (v: number) => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, v, true);
	return b;
};
const U64 = (v: bigint | number) => {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, typeof v === "bigint" ? v : BigInt(v), true);
	return b;
};
const hex = (v: bigint | number | null | undefined) => (v === null || v === undefined ? String(v) : `0x${BigInt(v).toString(16)}`);

// ---------------------------------------------------------------- 1. libffi core symbols
console.log("== 1. libffi core symbols");
const CIF_DEF = { args: ["ptr", "i32", "u32", "ptr", "ptr"], returns: "i32" } as const;
const CALL_DEF = { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" } as const;
const PTR_DEF = { args: ["ptr"], returns: "ptr" } as const;

// bun:ffi throws at dlopen() time for a missing symbol, so a one-symbol dlopen is also the
// cleanest existence test.
const exists = (lib: string, name: string, def: object) => {
	try {
		dlopen(lib, { [name]: def });
		return true;
	} catch {
		return false;
	}
};
for (const [name, def] of [
	["ffi_prep_cif", CIF_DEF],
	["ffi_call", CALL_DEF],
	["ffi_prep_closure_loc", { args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" }],
	["ffi_closure_alloc", { args: ["u64", "ptr"], returns: "ptr" }],
	["ffi_closure_free", { args: ["ptr"], returns: "void" }],
] as const) {
	check(`symbol ${name}`, () => (exists(LIBFFI, name, def) ? "resolvable" : "ABSENT"));
}

let ffi: ReturnType<typeof dlopen>;
try {
	ffi = dlopen(LIBFFI, {
		ffi_prep_cif: CIF_DEF,
		ffi_call: CALL_DEF,
		ffi_prep_cif_var: { args: ["ptr", "i32", "u32", "u32", "ptr", "ptr"], returns: "i32" },
	});
	ok("dlopen libffi (prep_cif + call + prep_cif_var)", "handle acquired, no artifact");
} catch (e) {
	bad("dlopen libffi", e instanceof Error ? e.message : String(e));
	process.exit(1);
}

// ---------------------------------------------------------------- 3. ffi_type globals
// bun:ffi exposes every declared symbol as a callable. The ffi_type_* names are DATA, not code,
// so dlopen() hands back a stub and never the address. dlsym() on the libffi handle is the only
// way to read them, and it needs a real handle: RTLD_DEFAULT (a null handle) does NOT see them,
// because libffi is loaded RTLD_LOCAL.
console.log("== 2. exported ffi_type globals");
const ffiHandle = Number(dlopenRaw(LIBFFI, 1));
const sym = (name: string) => {
	const p = dlsym(ffiHandle, name);
	if (p === null || p === undefined || p === 0) return undefined;
	return Number(p);
};
const T: Record<string, number> = {};
for (const name of ["ffi_type_void", "ffi_type_pointer", "ffi_type_sint32", "ffi_type_sint64", "ffi_type_uint64", "ffi_type_double", "ffi_type_float", "ffi_type_struct"] as const) {
	check(`dlsym(${name})`, () => {
		const a = sym(name);
		if (a === undefined) return "ABSENT (not exported)";
		T[name] = a;
		return `address ${hex(a)}`;
	});
}
check("ffi_type_sint64 contents {size, alignment, type}", () => {
	if (T.ffi_type_sint64 === undefined) throw new Error("ffi_type_sint64 unresolved");
	const p = T.ffi_type_sint64;
	const out = { size: read.u64(p), alignment: read.u16(p + 8), type: read.u16(p + 10), elements: read.ptr(p + 16) };
	if (out.size !== 8n || out.type !== 12) throw new Error(`unexpected: ${JSON.stringify(out, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))}`);
	return out; // size 8, type 12 == FFI_TYPE_SINT64
});
check("ffi_type_pointer contents", () => {
	if (T.ffi_type_pointer === undefined) throw new Error("ffi_type_pointer unresolved");
	const p = T.ffi_type_pointer;
	const out = { size: read.u64(p), alignment: read.u16(p + 8), type: read.u16(p + 10) };
	if (out.type !== 14) throw new Error(`type ${out.type}, expected 14 (FFI_TYPE_POINTER)`);
	return out;
});

// ---------------------------------------------------------------- 4. write primitive
console.log("== 3. write primitive: memcpy(ptr, buffer, u64)");
check("malloc 8, memcpy an 8-byte pattern in, read it back with read.u64", () => {
	const dest = A(8);
	const pattern = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
	memcpy(dest, new Uint8Array(pattern), 8);
	const back: number[] = [];
	for (let i = 0; i < 8; i++) back.push(read.u8(dest + i));
	if (back.join(",") !== pattern.join(",")) throw new Error(`readback ${back.join(",")}`);
	return { bytes: back, "read.u64": read.u64(dest) };
});
check("the same memcpy builds an ffi_cif and an ffi_type graph in malloc'd memory", () => {
	// ffi_type { size_t size; unsigned short alignment; unsigned short type; ffi_type **elements; }
	const t = A(24);
	P(t, U64(8n));
	P(t + 8, U16(8));
	P(t + 10, U16(12));
	P(t + 16, U64(0));
	const back = { size: read.u64(t), alignment: read.u16(t + 8), type: read.u16(t + 10) };
	if (back.type !== 12 || back.size !== 8n) throw new Error(`wrote the wrong bytes: ${JSON.stringify(back, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))}`);
	return { hand_built: back, libffi_sint64: { address: hex(T.ffi_type_sint64) } };
});

// ---------------------------------------------------------------- cif / call helpers
const FFI_DEFAULT_ABI = 1; // FFI_SYSV on darwin/arm64 (ffitarget_arm64.h: FFI_DEFAULT_ABI = FFI_SYSV)
// ffi_cif is 40 bytes here, not 32: Apple arm64 adds `FFI_EXTRA_CIF_FIELDS unsigned aarch64_nfixedargs`.
const CIF_SIZE = 40;
const CIF_ALLOCS: number[] = [];
function mkCif(nargs: number, argTypes: number, rtype: number, variadic = false, nfixed = nargs) {
	const cif = A(CIF_SIZE);
	CIF_ALLOCS.push(cif);
	// zero it: malloc does not, and ffi_prep_cif reads the whole struct
	P(cif, new Uint8Array(CIF_SIZE));
	P(cif, U32(FFI_DEFAULT_ABI));
	P(cif + 4, U32(nargs));
	P(cif + 8, U64(argTypes));
	P(cif + 16, U64(rtype));
	const st = variadic ? ffi.symbols.ffi_prep_cif_var(cif, FFI_DEFAULT_ABI, nfixed, nargs, rtype, argTypes) : ffi.symbols.ffi_prep_cif(cif, FFI_DEFAULT_ABI, nargs, rtype, argTypes);
	if (st !== 0) throw new Error(`ffi_prep_cif returned ${st} (FFI_OK is 0)`);
	return cif;
}
// avalue is void** : avalue[i] must POINT AT the argument's storage.
function ffiCall(cif: number, fn: number, values: (bigint | number)[]) {
	const av = A(8 * values.length);
	values.forEach((v, i) => {
		const slot = A(16);
		P(slot, U64(v));
		P(av + i * 8, U64(slot));
	});
	const ret = A(64);
	P(ret, new Uint8Array(64)); // a struct return is written in full; keep it deterministic
	ffi.symbols.ffi_call(cif, fn, ret, av);
	return ret;
}

// ---------------------------------------------------------------- 5. ffi_call end to end
console.log("== 4. ffi_call end to end");
check("strlen(\"hello, crust\")", () => {
	const TEXT = "hello, crust";
	const buf = A(TEXT.length + 1);
	P(buf, new TextEncoder().encode(TEXT), TEXT.length);
	P(buf + TEXT.length, new Uint8Array([0]), 1);
	const argTypes = A(8);
	P(argTypes, U64(T.ffi_type_pointer));
	const ret = ffiCall(mkCif(1, argTypes, T.ffi_type_sint64), sym("strlen"), [buf]);
	const got = read.u64(ret);
	if (got !== BigInt(TEXT.length)) throw new Error(`returned ${got}, expected ${TEXT.length}`);
	return { strlen: got };
});
check("abs(-42) (a value argument, not a pointer)", () => {
	const argTypes = A(8);
	P(argTypes, U64(T.ffi_type_sint32));
	const ret = ffiCall(mkCif(1, argTypes, T.ffi_type_sint32), sym("abs"), [-42]);
	const got = read.i32(ret);
	if (got !== 42) throw new Error(`returned ${got}`);
	return { "abs(-42)": got };
});
check("strcmp(\"abc\", \"abd\") < 0 and strcmp(\"abd\", \"abc\") > 0 (argument order)", () => {
	const mk = (s: string) => {
		const b = A(s.length + 1);
		P(b, new TextEncoder().encode(s), s.length);
		P(b + s.length, new Uint8Array([0]), 1);
		return b;
	};
	const argTypes = A(16);
	P(argTypes, U64(T.ffi_type_pointer));
	P(argTypes + 8, U64(T.ffi_type_pointer));
	const fn = sym("strcmp");
	const lt = read.i32(ffiCall(mkCif(2, argTypes, T.ffi_type_sint32), fn, [mk("abc"), mk("abd")]));
	const gt = read.i32(ffiCall(mkCif(2, argTypes, T.ffi_type_sint32), fn, [mk("abd"), mk("abc")]));
	if (!(lt < 0 && gt > 0)) throw new Error(`got ${lt} and ${gt}`);
	return { "strcmp(abc,abd)": lt, "strcmp(abd,abc)": gt };
});
check("div(100,7) through an 8-byte struct return", () => {
	// div_t { int quot; int rem; } — a struct built by hand, with its elements array
	const elems = A(24);
	P(elems, U64(T.ffi_type_sint32));
	P(elems + 8, U64(T.ffi_type_sint32));
	P(elems + 16, U64(0)); // NULL-terminated
	const structType = A(24);
	P(structType, U64(8n));
	P(structType + 8, U16(4));
	P(structType + 10, U16(13)); // FFI_TYPE_STRUCT
	P(structType + 16, U64(elems));
	const argTypes = A(16);
	P(argTypes, U64(T.ffi_type_sint32));
	P(argTypes + 8, U64(T.ffi_type_sint32));
	const ret = ffiCall(mkCif(2, argTypes, structType), sym("div"), [100, 7]);
	const quot = read.i32(ret);
	const rem = read.i32(ret + 4);
	if (quot !== 14 || rem !== 2) throw new Error(`div(100,7) = {quot:${quot}, rem:${rem}}, expected {14, 2}`);
	return { "div(100,7)": { quot, rem } };
});

// ---------------------------------------------------------------- 6. Objective-C through ffi_call
console.log("== 5. Objective-C through the same ffi_call");
// Foundation is not loaded until something asks for it; objc_getClass returns NULL without it.
check("dlopen Foundation so classes exist", () => {
	const h = dlopen(FOUNDATION, { NSGetSizeAndAlignment: { args: ["cstring", "ptr", "ptr"], returns: "cstring" } });
	return { handle: "acquired", NSGetSizeAndAlignment: typeof h.symbols.NSGetSizeAndAlignment };
});
const objc = dlopen(LIBOBJC, {
	objc_getClass: { args: ["cstring"], returns: "ptr" },
	sel_registerName: { args: ["cstring"], returns: "ptr" },
	class_getName: { args: ["ptr"], returns: "cstring" },
	object_getClassName: { args: ["ptr"], returns: "cstring" },
});
const cls = (n: string) => Number(objc.symbols.objc_getClass(n));
const sel = (n: string) => Number(objc.symbols.sel_registerName(n));
const msgSend = Number(dlsym(ffiHandle, "objc_msgSend")) || Number(dlsym(Number(dlopenRaw(LIBOBJC, 1)), "objc_msgSend"));

check("objc_getClass(\"NSObject\") + sel_registerName(\"description\")", () => {
	const c = cls("NSObject");
	const s = sel("description");
	if (!c) throw new Error("NSObject class is NULL (Foundation not loaded?)");
	if (!s) throw new Error("description selector is NULL");
	return { class: hex(c), selector: hex(s) };
});

// (id, SEL) -> id is enough for every link in an ObjC chain
const ID_ARG_TYPES = (() => {
	const at = A(16);
	P(at, U64(T.ffi_type_pointer));
	P(at + 8, U64(T.ffi_type_pointer));
	return at;
})();
const MSG_CIF = mkCif(2, ID_ARG_TYPES, T.ffi_type_pointer);
function send(receiver: number, selector: number): bigint {
	const ret = ffiCall(MSG_CIF, msgSend, [receiver, selector]);
	return read.u64(ret);
}

check("objc_msgSend(NSObject, description) through ffi_call", () => {
	const id = send(cls("NSObject"), sel("description"));
	if (id === 0n) throw new Error("returned NULL");
	return { id: hex(id) };
});
check("objc_msgSend chain: NSProcessInfo.processInfo.operatingSystemVersionString.UTF8String", () => {
	const info = send(cls("NSProcessInfo"), sel("processInfo"));
	if (info === 0n) throw new Error("[NSProcessInfo processInfo] was NULL");
	const ver = send(Number(info), sel("operatingSystemVersionString"));
	if (ver === 0n) throw new Error("operatingSystemVersionString was NULL");
	const utf8 = send(Number(ver), sel("UTF8String"));
	if (utf8 === 0n) throw new Error("UTF8String was NULL");
	const bytes: number[] = [];
	for (let i = 0; i < 64; i++) {
		const b = read.u8(Number(utf8) + i);
		if (b === 0) break;
		bytes.push(b);
	}
	const text = new TextDecoder().decode(new Uint8Array(bytes));
	if (!text) throw new Error("empty version string");
	return { version: text };
});
check("objc_msgSend with a C-string argument: NSString.stringWithUTF8String:", () => {
	const at = A(24);
	P(at, U64(T.ffi_type_pointer));
	P(at + 8, U64(T.ffi_type_pointer));
	P(at + 16, U64(T.ffi_type_pointer));
	const cif = mkCif(3, at, T.ffi_type_pointer);
	const text = A(7);
	const bytes = new TextEncoder().encode("hi obc");
	P(text, bytes, bytes.length);
	P(text + bytes.length, new Uint8Array([0]), 1);
	const ret = ffiCall(cif, msgSend, [cls("NSString"), sel("stringWithUTF8String:"), text]);
	const str = read.u64(ret);
	if (str === 0n) throw new Error("returned NULL");
	// NOTE: `str` must stay a bigint. A tagged pointer (small NSString) is 0xbe25... — above 2^53,
	// so Number() truncates it and the next objc_msgSend crashes. Every pointer stays bigint.
	const len = send(str, sel("length"));
	return { nsstring: hex(str), length: len, tagged: str > (1n << 48n) ? "yes — would break Number()" : "no" };
});

// ---------------------------------------------------------------- 7. closures (the delegate path)
// A closure's `fun` has libffi's own signature: void (*)(ffi_cif*, void *ret, void **args, void *user_data).
// Handing a JSCallback the user-facing signature does NOT work — libffi calls it with those four
// arguments and the JS body sees cif/ret/args as its "arguments". The bridge must be written by hand.
console.log("== 6. closure: an ObjC delegate IMP pointing back into JavaScript");
{
	const { JSCallback } = require("bun:ffi") as typeof import("bun:ffi");
	const closureLib = dlopen(LIBFFI, {
		ffi_closure_alloc: { args: ["u64", "ptr"], returns: "ptr" },
		ffi_prep_closure_loc: { args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
		ffi_closure_free: { args: ["ptr"], returns: "void" },
	});

	// int32_t answer(id self, SEL _cmd) — the shape of an ObjC delegate method
	const argTypes = A(16);
	P(argTypes, U64(T.ffi_type_pointer));
	P(argTypes + 8, U64(T.ffi_type_pointer));
	const cif = mkCif(2, argTypes, T.ffi_type_sint32);

	let jsSaw = { self: 0n, cmd: 0n, invocations: 0 };
	const handler = new JSCallback((_cif: unknown, ret: number, args: number, _ud: unknown) => {
		jsSaw = { self: read.ptr(args), cmd: read.ptr(args + 8), invocations: jsSaw.invocations + 1 };
		const out = new Uint8Array(4);
		new DataView(out.buffer).setInt32(0, 4200, true);
		memcpy(ret, out, 4);
	}, { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" } as never);

	const codeSlot = A(8);
	P(codeSlot, U64(0));
	const closure = closureLib.symbols.ffi_closure_alloc(64, codeSlot);
	const code = read.u64(codeSlot);
	const st = closureLib.symbols.ffi_prep_closure_loc(closure, cif, handler.ptr, 0, code);

	// call the closure directly, with a (self, _cmd) argument pair
	const ret = ffiCall(cif, code, [cls("NSObject"), sel("answer")]);
	const got = read.i32(ret);
	check("ffi_prep_closure_loc + a closure called with (self, _cmd) reaches JS and returns", () => {
		if (st !== 0) throw new Error(`ffi_prep_closure_loc returned ${st}`);
		if (got !== 4200) throw new Error(`closure returned ${got}, expected 4200`);
		return { "closure(self,_cmd)": got, js_invocations: jsSaw.invocations, js_saw_self: hex(jsSaw.self) };
	});

	// the real proof: install that closure as a method on a runtime-created class and message it
	check("runtime-created ObjC class + JS IMP: [instance answer] == 4200", () => {
		const objcLib = dlopen(LIBOBJC, {
			objc_getClass: { args: ["cstring"], returns: "ptr" },
			sel_registerName: { args: ["cstring"], returns: "ptr" },
			objc_allocateClassPair: { args: ["ptr", "cstring", "u64"], returns: "ptr" },
			class_addMethod: { args: ["ptr", "ptr", "ptr", "cstring"], returns: "i32" },
			objc_registerClassPair: { args: ["ptr"], returns: "void" },
			class_getName: { args: ["ptr"], returns: "cstring" },
		});
		const newCls = objcLib.symbols.objc_allocateClassPair(cls("NSObject"), "CrustProbeDelegate", 0);
		const answerSel = objcLib.symbols.sel_registerName("answer");
		const added = objcLib.symbols.class_addMethod(newCls, answerSel, code, "i32@:");
		if (added !== 1) throw new Error(`class_addMethod returned ${added}`);
		objcLib.symbols.objc_registerClassPair(newCls);
		const inst = send(newCls, sel("alloc"));
		const got = read.i32(ffiCall(cif, msgSend, [Number(inst), answerSel]));
		if (got !== 4200) throw new Error(`[inst answer] returned ${got}, expected 4200`);
		return { class: objcLib.symbols.class_getName(newCls), "[inst answer]": got };
	});
}

// ---------------------------------------------------------------- pointer representation
console.log("== 7. pointer representation (matters everywhere)");
check("a ptr-returning symbol gives number or bigint", () => {
	const p = objc.symbols.objc_getClass("NSObject");
	return { typeof: typeof p, value: String(p), exact: Number.isSafeInteger(p) ? "number, exact (< 2^53)" : "number, NOT exact" };
});
check("read.ptr() return type", () => {
	const v = read.ptr(T.ffi_type_void);
	return { typeof: typeof v, value: String(v) };
});
check("read.u64() return type", () => {
	const v = read.u64(T.ffi_type_void);
	return { typeof: typeof v, value: String(v) };
});
check("a malloc'd pointer round-trips through number without loss", () => {
	const p = A(8);
	const back = read.u64(p);
	P(p, U64(0x1122334455667788n));
	const again = read.u64(p);
	return { malloc: String(p), exact: Number.isSafeInteger(p), after_write: again };
});

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);