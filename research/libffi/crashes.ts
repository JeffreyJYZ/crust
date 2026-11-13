// crashes: every failure mode reproduced in a CHILD process, so the parent can report the exact
// signal instead of dying. Run with no argument; it spawns itself once per mode.
//
//   bun crashes.ts            parent: run every mode, print exit status
//   bun crashes.ts cif32      child: a 32-byte ffi_cif (the non-Apple size)
//   bun crashes.ts tag        child: Number() on a tagged NSString pointer
//   bun crashes.ts avalue     child: one indirection too many in avalue
//   bun crashes.ts closure    child: JSCallback body written as (self, cmd)
//   bun crashes.ts struct     child: ffi_type_struct looked up by name

import { dlopen, read, JSCallback } from "bun:ffi";

const LIBFFI = "/usr/lib/libffi.dylib";
const LIBOBJC = "/usr/lib/libobjc.A.dylib";
const LIBSYSTEM = "/usr/lib/libSystem.B.dylib";
const FOUNDATION = "/System/Library/Frameworks/Foundation.framework/Foundation";

const sys = dlopen(LIBSYSTEM, {
	malloc: { args: ["u64"], returns: "ptr" },
	free: { args: ["ptr"], returns: "void" },
	memcpy: { args: ["ptr", "buffer", "u64"], returns: "ptr" },
	dlopen: { args: ["cstring", "i32"], returns: "ptr" },
	dlsym: { args: ["ptr", "cstring"], returns: "ptr" },
});
const malloc = sys.symbols.malloc;
const rawMemcpy = sys.symbols.memcpy;
const dlsym = sys.symbols.dlsym;
const ffiHandle = Number(sys.symbols.dlopen(LIBFFI, 1));
const ffi = dlopen(LIBFFI, {
	ffi_prep_cif: { args: ["ptr", "i32", "u32", "ptr", "ptr"], returns: "i32" },
	ffi_call: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" },
});
const typeAddr = (n: string) => Number(dlsym(ffiHandle, n));
const T_I32 = typeAddr("ffi_type_sint32");
const T_PTR = typeAddr("ffi_type_pointer");
const T_I64 = typeAddr("ffi_type_sint64");

// bytes are always written with the length taken from the buffer, never hand-counted
const mem = (addr: number, bytes: Uint8Array) => rawMemcpy(addr, bytes, bytes.length);
const u64 = (v: bigint | number) => {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
	return b;
};
const u32 = (v: number) => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, v, true);
	return b;
};
const Z = (addr: number, n: number) => rawMemcpy(addr, new Uint8Array(n), n);
const A = (n: number) => Number(malloc(BigInt(n)));
const hex = (v: number | bigint) => `0x${BigInt(v).toString(16)}`;

function argTypesOf(...types: number[]) {
	const p = A(types.length * 8);
	types.forEach((t, i) => mem(p + i * 8, u64(t)));
	return p;
}
function prep(cif: number, at: number, rtype: number, nargs: number, size = 40) {
	Z(cif, size);
	mem(cif, u32(1)); // FFI_DEFAULT_ABI == FFI_SYSV on arm64
	mem(cif + 4, u32(nargs));
	mem(cif + 8, u64(at));
	mem(cif + 16, u64(rtype));
	return ffi.symbols.ffi_prep_cif(cif, 1, nargs, rtype, at);
}
// a call whose arguments are already staged: avalue[i] points at slot i
function stage(values: number[]) {
	const av = A(values.length * 8);
	const slots: number[] = [];
	values.forEach((v, i) => {
		const s = A(16);
		mem(s, u64(v));
		slots.push(s);
		mem(av + i * 8, u64(s));
	});
	return { av, slots };
}

const mode = process.argv[2];

if (mode === "cif32") {
	// A 32-byte cif — the size ffi_cif has on every non-Apple target. prep writes 40.
	const cif = A(32);
	const at = argTypesOf(T_I32);
	const { av } = stage([0xffffffd6]); // -42 as int32
	const ret = A(16);
	const st = prep(cif, at, T_I32, 1, 32);
	console.log(`cif at ${hex(cif)}, prep=${st}`);
	ffi.symbols.ffi_call(cif, Number(dlsym(ffiHandle, "abs")), ret, av);
	console.log(`abs(-42) with a 32-byte cif = ${read.i32(ret)} — reached the end without crashing`);
} else if (mode === "tag") {
	dlopen(FOUNDATION, { NSGetSizeAndAlignment: { args: ["cstring", "ptr", "ptr"], returns: "cstring" } });
	const objc = dlopen(LIBOBJC, {
		objc_getClass: { args: ["cstring"], returns: "ptr" },
		sel_registerName: { args: ["cstring"], returns: "ptr" },
	});
	const cls = (n: string) => Number(objc.symbols.objc_getClass(n));
	const sel = (n: string) => Number(objc.symbols.sel_registerName(n));
	const msgSend = Number(dlsym(-2, "objc_msgSend")); // RTLD_DEFAULT sees libobjcMsgSend
	const text = A(8);
	const bytes = new TextEncoder().encode("hi obc");
	mem(text, bytes);
	mem(text + bytes.length, new Uint8Array([0]));

	// [NSString stringWithUTF8String:"hi obc"]
	const cif3 = A(40);
	if (prep(cif3, argTypesOf(T_PTR, T_PTR, T_PTR), T_PTR, 3) !== 0) throw new Error("prep3 failed");
	const { av: av3 } = stage([cls("NSString"), sel("stringWithUTF8String:"), text]);
	const ret3 = A(16);
	ffi.symbols.ffi_call(cif3, msgSend, ret3, av3);
	const id = read.u64(ret3);
	console.log(`NSString id = ${hex(id)} above 2^53 = ${id > 1n << 53n}`);

	// [id length] with Number(id) — the truncation
	const cif2 = A(40);
	if (prep(cif2, argTypesOf(T_PTR, T_PTR), T_I64, 2) !== 0) throw new Error("prep2 failed");
	const { av: av2 } = stage([Number(id), sel("length")]);
	const ret2 = A(16);
	ffi.symbols.ffi_call(cif2, msgSend, ret2, av2);
	console.log(`[Number(id) length] = ${read.i64(ret2)} — reached the end without crashing`);
} else if (mode === "avalue") {
	// avalue[0] -> slot -> &value: one hop too many. abs() then reads the ADDRESS as its int,
	// so the call succeeds and returns a plausible-looking wrong number. No crash, no diagnostic.
	const cif = A(40);
	if (prep(cif, argTypesOf(T_I32), T_I32, 1) !== 0) throw new Error("prep failed");
	const value = A(8);
	mem(value, u32(0xffffffd6)); // -42
	const slot = A(8);
	mem(slot, u64(value)); // slot holds &value
	const av = A(8);
	mem(av, u64(slot)); // WRONG: avalue[0] should be `value`, not &slot
	const ret = A(16);
	ffi.symbols.ffi_call(cif, Number(dlsym(ffiHandle, "abs")), ret, av);
	console.log(`abs(-42) with one indirection too many = ${read.i32(ret)} (silent garbage, exit 0)`);
} else if (mode === "closure") {
	// The JS body written as (self, cmd) while libffi calls (cif, ret, args, user_data).
	let bound: string[] = [];
	const handler = new JSCallback(
		(self: unknown, cmd: unknown) => {
			bound = [typeof self, typeof cmd];
		},
		{ args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" },
	);
	const cif = A(40);
	if (prep(cif, argTypesOf(T_PTR, T_PTR), T_PTR, 2) !== 0) throw new Error("prep failed");
	const codeSlot = A(8);
	mem(codeSlot, u64(0));
	const clos = dlopen(LIBFFI, {
		ffi_closure_alloc: { args: ["u64", "ptr"], returns: "ptr" },
		ffi_prep_closure_loc: { args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
	});
	const memBlock = clos.symbols.ffi_closure_alloc(64, codeSlot);
	const code = read.u64(codeSlot);
	const st = clos.symbols.ffi_prep_closure_loc(memBlock, cif, handler.ptr, 0, code);
	const { av } = stage([0x1234, 0x5678]);
	const ret = A(16);
	ffi.symbols.ffi_call(cif, code, ret, av);
	console.log(`prep=${st} the two bindings named self/cmd were ${JSON.stringify(bound)} — cif and ret, not self and _cmd`);
} else if (mode === "struct") {
	const p = dlsym(ffiHandle, "ffi_type_struct");
	const n = p === null || p === undefined ? 0 : Number(p);
	console.log(`dlsym(ffi_type_struct) = ${n ? hex(n) : "NULL — not exported"}`);
	console.log("a struct type must be built: {size, alignment, type: 13, elements: NULL-terminated}");
} else {
	// ---------------------------------------------------------------- parent
	const modes: [string, string][] = [
		["cif32", "32-byte ffi_cif (the non-Apple size)"],
		["tag", "Number() on a tagged NSString pointer"],
		["avalue", "avalue[0] one indirection too deep"],
		["closure", "JSCallback body written as (self, cmd)"],
		["struct", "ffi_type_struct looked up by name"],
	];
	console.log(`parent pid ${process.pid}, bun ${Bun.version}\n`);
	for (const [m, label] of modes) {
		const r = Bun.spawnSync([process.execPath, import.meta.path, m], { stdout: "pipe", stderr: "pipe" });
		const out = new TextDecoder().decode(r.stdout).trim().split("\n").filter(Boolean);
		const err = new TextDecoder().decode(r.stderr).trim().split("\n").filter(Boolean);
		const dead = (r.exitCode ?? 0) !== 0 || (r.signalCode != null && r.signalCode !== 0);
		const status = r.signalCode ? `signal ${r.signalCode}` : `exit ${r.exitCode}`;
		console.log(`${dead ? "CRASH    " : "SURVIVED"}  ${label.padEnd(44)} ${status}  [signalCode=${String(r.signalCode)} exitCode=${String(r.exitCode)}]`);
		for (const line of out) console.log(`           out: ${line}`);
		for (const line of err.slice(-2)) console.log(`           err: ${line}`);
	}
	process.exit(0);
}
