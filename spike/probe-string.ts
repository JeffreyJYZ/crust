#!/usr/bin/env bun
// Bisect the NSString path. One crash per process, so every claim is printed
// before the next call, and each case can be selected with argv[2].
import { cc, FFIType, ptr } from "bun:ffi";

const P = FFIType.ptr;
const I64 = FFIType.i64;
const CS = FFIType.cstring;
const I32 = FFIType.i32;

const shim = cc({
	source: `${import.meta.dir}/shim.c`,
	flags: ["-framework", "AppKit", "-framework", "Foundation"],
	symbols: {
		shim_cls: { args: [P], returns: P },
		shim_cstr_len: { args: [P], returns: I64 },
		shim_data: { args: [P, I64], returns: P },
		shim_nsstring_from_data: { args: [P], returns: P },
		shim_string: { args: [P], returns: P },
		shim_length: { args: [P], returns: I64 },
		shim_utf8: { args: [P], returns: CS },
		shim_responds: { args: [P, P], returns: I32 },
		shim_sel: { args: [P], returns: P },
	},
});

const buf = new Uint8Array([..."crust M0\0"].map((c) => c.charCodeAt(0)));
const p = ptr(buf) as unknown as number;
const c = (s: string) => ptr(new TextEncoder().encode(`${s}\0`)) as unknown as number;

const say = (...a: unknown[]) => console.log(...a);
const kase = process.argv[2] ?? "all";

say("NSData class      =", shim.symbols.shim_cls(c("NSData")));
say("NSString class    =", shim.symbols.shim_cls(c("NSString")));
say("responds dataWith…=", shim.symbols.shim_responds(shim.symbols.shim_cls(c("NSData")), shim.symbols.shim_sel(c("dataWithBytes:length:"))));

say("cstr len of buffer=", shim.symbols.shim_cstr_len(p), "(want 9)");
if (kase === "cstr") process.exit(0);

say("dataWithBytes:length: -> calling");
const data = shim.symbols.shim_data(p, 9);
say("data object       =", data);
if (kase === "data") process.exit(0);

say("initWithData:encoding: -> calling on", data);
const s = shim.symbols.shim_nsstring_from_data(data);
say("nsstring          =", s);
if (kase === "fromdata") process.exit(0);

say("length            =", shim.symbols.shim_length(s), "(want 9)");
if (kase === "length") process.exit(0);

say("utf8              =", JSON.stringify(shim.symbols.shim_utf8(s)));

say("shim_string one-shot -> calling");
const s2 = shim.symbols.shim_string(p);
say("shim_string       =", s2, "len", shim.symbols.shim_length(s2), JSON.stringify(shim.symbols.shim_utf8(s2)));
process.exit(0);
