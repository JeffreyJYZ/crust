// limits: fills the measurements the verdict needs beyond "it works".
//   A. malloc/free are real (RSS does not grow when every block is freed)
//   B. the write primitive at 1 KB, not just 8 bytes
//   C. ffi_cif is 40 bytes: proven by a canary, not by the header
//   D. which representation every pointer-shaped value comes back as

import { dlopen, read } from "bun:ffi";

const LIBFFI = "/usr/lib/libffi.dylib";
const LIBOBJC = "/usr/lib/libobjc.A.dylib";
const LIBSYSTEM = "/usr/lib/libSystem.B.dylib";
const FOUNDATION = "/System/Library/Frameworks/Foundation.framework/Foundation";

let fails = 0;
const ok = (l: string, e: unknown) => console.log(`PASS  ${l} :: ${e}`);
const bad = (l: string, e: unknown) => {
	fails++;
	console.log(`FAIL  ${l} :: ${e}`);
};
function check(label: string, fn: () => unknown) {
	try {
		return ok(label, fmt(fn()));
	} catch (e) {
		bad(label, e instanceof Error ? e.message : String(e));
	}
}
function fmt(v: unknown): string {
	if (typeof v === "bigint") return `${v}n`;
	if (typeof v === "number" || typeof v === "string") return String(v);
	try {
		return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
	} catch {
		return String(v);
	}
}

const sys = dlopen(LIBSYSTEM, {
	malloc: { args: ["u64"], returns: "ptr" },
	free: { args: ["ptr"], returns: "void" },
	memcpy: { args: ["ptr", "buffer", "u64"], returns: "ptr" },
	dlopen: { args: ["cstring", "i32"], returns: "ptr" },
	dlsym: { args: ["ptr", "cstring"], returns: "ptr" },
});
const malloc = sys.symbols.malloc;
const free = sys.symbols.free;
const memcpy = sys.symbols.memcpy;
const dlsym = sys.symbols.dlsym;
const ffiHandle = Number(sys.symbols.dlopen(LIBFFI, 1));

const ffi = dlopen(LIBFFI, {
	ffi_prep_cif: { args: ["ptr", "i32", "u32", "ptr", "ptr"], returns: "i32" },
	ffi_call: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" },
});
const FFI_DEFAULT_ABI = 1;
const CIF_SIZE = 40;
const typeAddr = (n: string) => Number(dlsym(ffiHandle, n));
const T_I32 = typeAddr("ffi_type_sint32");
const T_PTR = typeAddr("ffi_type_pointer");

const rssKB = (): number => {
	const r = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(process.pid)]);
	return Number(new TextDecoder().decode(r.stdout).trim());
};
const hex = (v: number | bigint) => `0x${BigInt(v).toString(16)}`;
const U8 = (n: number, fill = 0) => new Uint8Array(n).fill(fill);
const P = (addr: number, bytes: Uint8Array) => memcpy(addr, bytes, bytes.length);
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

// ---------------------------------------------------------------- A. malloc / free
console.log("== A. malloc / free through bun:ffi");
check("malloc(8) returns a non-null pointer, free(ptr) returns void", () => {
	const p = Number(malloc(8n));
	if (!p) throw new Error("malloc returned NULL");
	const r = free(p);
	return { malloc: hex(p), free_returned: r === undefined ? "undefined (void)" : String(r) };
});
{
	// 100k allocations of 8 KiB, each freed: 800 MiB of traffic. If free were a no-op the
	// process would climb by ~800 MiB; if it works, RSS stays within a few MiB.
	const before = rssKB();
	for (let i = 0; i < 100_000; i++) free(Number(malloc(8192n)));
	const after = rssKB();
	const delta = after - before;
	const pass = delta < 64 * 1024; // < 64 MiB for 800 MiB of traffic
	console.log(`${pass ? "PASS" : "FAIL"}  free() actually returns memory :: 100k x 8 KiB malloc+free, RSS ${before} KiB -> ${after} KiB (${(delta / 1024).toFixed(1)} MiB)`);
	if (!pass) fails++;

	// the control: same loop minus free(). 16k x 8 KiB = 128 MiB that must survive.
	const b2 = rssKB();
	const keep: number[] = [];
	for (let i = 0; i < 16_000; i++) keep.push(Number(malloc(8192n)));
	const a2 = rssKB();
	const grow = a2 - b2;
	console.log(`INFO  control without free() :: 16k x 8 KiB, RSS ${b2} KiB -> ${a2} KiB (+${(grow / 1024).toFixed(1)} MiB)  [${keep.length} pointers held]`);
}

// ---------------------------------------------------------------- B. write primitive
console.log("== B. memcpy(ptr, buffer, u64) write primitive");
check("1 KiB pattern written, read back byte-exact, then selectively overwritten", () => {
	const p = Number(malloc(1024n));
	const pattern = new Uint8Array(1024);
	for (let i = 0; i < 1024; i++) pattern[i] = (i * 37 + 11) & 0xff;
	memcpy(p, pattern, 1024);
	let wrong = -1;
	for (let i = 0; i < 1024; i++) {
		if (read.u8(p + i) !== pattern[i]) {
			wrong = i;
			break;
		}
	}
	if (wrong >= 0) throw new Error(`mismatch at ${wrong}`);
	memcpy(p + 512, new Uint8Array([0xde, 0xad, 0xbe, 0xef]), 4);
	const after = [read.u8(p + 511), read.u8(p + 512), read.u8(p + 513), read.u8(p + 515), read.u8(p + 516)];
	const pass = after[1] === 0xde && after[2] === 0xad && after[3] === 0xef && after[4] === pattern[516];
	if (!pass) throw new Error(`overwrite landed wrong: ${after.join(",")}`);
	free(p);
	return { bytes_written: 1024, byte_exact: "yes", "overwrite at 512": after.map((b) => b.toString(16)).join(" ") };
});
check("memcpy return value", () => {
	const p = Number(malloc(16n));
	const ret = Number(memcpy(p, new Uint8Array(4), 4));
	return { returned: hex(ret), equals_dest: ret === p };
});

// ---------------------------------------------------------------- C. ffi_cif is 40 bytes
console.log("== C. ffi_cif size, measured");
check("ffi_prep_cif writes a field past offset 32 (canary at +32 is clobbered)", () => {
	// 96-byte block: cif at +48, canary 0x5A at +32 relative to the cif. One short straw:
	// if the struct were 32 bytes, prep would have no business touching that canary.
	const base = Number(malloc(96n));
	P(base, U8(96));
	P(base + 48, U8(40));
	P(base + 48 + 32, U8(8, 0x5a));
	const argTypes = Number(malloc(16n));
	P(argTypes, u64(T_I32));
	P(argTypes + 8, u64(T_I32));
	const cif = base + 48;
	P(cif, u32(FFI_DEFAULT_ABI));
	P(cif + 4, u32(2));
	P(cif + 8, u64(argTypes));
	P(cif + 16, u64(T_I32));
	const st = ffi.symbols.ffi_prep_cif(cif, FFI_DEFAULT_ABI, 2, T_I32, argTypes);
	if (st !== 0) throw new Error(`prep returned ${st}`);
	const tail: number[] = [];
	for (let i = 0; i < 8; i++) tail.push(read.u8(cif + 32 + i));
	if (tail.every((b) => b === 0x5a)) throw new Error("canary survived — nothing written past offset 32");
	return { canary_before: "5a 5a 5a 5a 5a 5a 5a 5a", canary_after: tail.map((b) => b.toString(16).padStart(2, "0")).join(" "), tail_as_u32: read.u32(cif + 32) };
});
check("the whole 40 bytes of a prepared cif, field by field", () => {
	const cif = Number(malloc(40n));
	P(cif, U8(40));
	const argTypes = Number(malloc(16n));
	P(argTypes, u64(T_I32));
	P(argTypes + 8, u64(T_I32));
	P(cif, u32(FFI_DEFAULT_ABI));
	P(cif + 4, u32(2));
	P(cif + 8, u64(argTypes));
	P(cif + 16, u64(T_I32));
	const st = ffi.symbols.ffi_prep_cif(cif, FFI_DEFAULT_ABI, 2, T_I32, argTypes);
	if (st !== 0) throw new Error(`prep returned ${st}`);
	const dump: number[] = [];
	for (let i = 0; i < 40; i++) dump.push(read.u8(cif + i));
	return {
		abi: read.u32(cif),
		nargs: read.u32(cif + 4),
		arg_types: hex(read.u64(cif + 8)),
		rtype: hex(read.u64(cif + 16)),
		bytes: read.u32(cif + 24),
		flags: read.u32(cif + 28),
		aarch64_nfixedargs: read.u32(cif + 32),
		offset36: read.u32(cif + 36),
		hex: dump.map((b) => b.toString(16).padStart(2, "0")).join(" "),
	};
});

// ---------------------------------------------------------------- D. pointer representation
console.log("== D. pointer representation");
const objc = dlopen(LIBOBJC, {
	objc_getClass: { args: ["cstring"], returns: "ptr" },
	sel_registerName: { args: ["cstring"], returns: "ptr" },
});
dlopen(FOUNDATION, { NSGetSizeAndAlignment: { args: ["cstring", "ptr", "ptr"], returns: "cstring" } });
check("ptr-returning symbol: typeof and exactness", () => {
	const p = objc.symbols.objc_getClass("NSObject");
	return { typeof: typeof p, value: String(p), safe_integer: Number.isSafeInteger(p), above_2_53: Number(p) > Number.MAX_SAFE_INTEGER };
});
check("read.ptr / read.u64 / read.u32 on the same word", () => {
	const p = Number(malloc(8n));
	P(p, u64(0xa78791898a900899n));
	return { "read.ptr": `${typeof read.ptr(p)} ${read.ptr(p)}`, "read.u64": `${typeof read.u64(p)} ${read.u64(p)}`, "read.u32": `${typeof read.u32(p)} ${read.u32(p)}` };
});
check("malloc/free accept what read.u64 returns (bigint) as well as number", () => {
	const p = Number(malloc(8n));
	const slot = Number(malloc(8n));
	P(slot, u64(p)); // the pointer as it comes back out of native memory
	const big = read.u64(slot);
	if (big === 0n) throw new Error("read.u64 gave 0 — the check would be vacuous");
	free(big as unknown as number);
	return { pointer_as_malloc_gave: hex(p), pointer_from_read_u64: `${big}n`, accepted_by_free: true };
});

// ---------------------------------------------------------------- E. scalar widths
console.log("== E. floating point, which the rest of the probe does not touch");
{
	const T_DBL = typeAddr("ffi_type_double");
	const T_FLT = typeAddr("ffi_type_float");
	const f64 = (v: number) => {
		const b = new Uint8Array(8);
		new DataView(b.buffer).setFloat64(0, v, true);
		return b;
	};
	const f32 = (v: number) => {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setFloat32(0, v, true);
		return b;
	};
	const asF64 = (bits: bigint) => {
		const b = new Uint8Array(8);
		new DataView(b.buffer).setBigUint64(0, bits, true);
		return new DataView(b.buffer).getFloat64(0, true);
	};
	const asF32 = (bits: number) => {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setUint32(0, bits, true);
		return new DataView(b.buffer).getFloat32(0, true);
	};
	const call1 = (rtype: number, argType: number, slotBytes: Uint8Array, fn: number, readBits: (ret: number) => number) => {
		const cif = Number(malloc(40n));
		P(cif, new Uint8Array(40));
		const at = Number(malloc(8n));
		P(at, u64(argType));
		P(cif, u32(FFI_DEFAULT_ABI));
		P(cif + 4, u32(1));
		P(cif + 8, u64(at));
		P(cif + 16, u64(rtype));
		const st = ffi.symbols.ffi_prep_cif(cif, FFI_DEFAULT_ABI, 1, rtype, at);
		if (st !== 0) throw new Error(`prep ${st}`);
		const slot = Number(malloc(16n));
		P(slot, slotBytes);
		const av = Number(malloc(8n));
		P(av, u64(slot));
		const ret = Number(malloc(16n));
		ffi.symbols.ffi_call(cif, fn, ret, av);
		return readBits(ret);
	};
	check("double argument and double return: sqrt(2)", () => {
		const got = call1(T_DBL, T_DBL, f64(2), Number(dlsym(-2, "sqrt")), (r) => asF64(read.u64(r)));
		if (Math.abs(got - Math.SQRT2) > 1e-15) throw new Error(`got ${got}, expected ${Math.SQRT2}`);
		return { sqrt2: got, matches_Math_SQRT2: true };
	});
	check("float argument and float return: fabsf(-3.5)", () => {
		const got = call1(T_FLT, T_FLT, f32(-3.5), Number(dlsym(-2, "fabsf")), (r) => asF32(read.u32(r)));
		if (got !== 3.5) throw new Error(`got ${got}`);
		return { fabsf: got };
	});
	check("double return read as an int64 would be garbage (representation matters)", () => {
		const got = call1(T_DBL, T_DBL, f64(2), Number(dlsym(-2, "sqrt")), (r) => Number(read.u64(r)));
		return { same_bits_as_u64: got, as_double: asF64(BigInt(got)) };
	});
}

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
