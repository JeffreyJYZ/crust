// symcheck: which handle actually carries objc_msgSend, and what each lookup returns.
// objc_msgSend is a re-export of /usr/lib/objc/libobjcMsgSend.dylib, so the answer is not obvious.

import { dlopen } from "bun:ffi";

const sys = dlopen("/usr/lib/libSystem.B.dylib", {
	dlopen: { args: ["cstring", "i32"], returns: "ptr" },
	dlsym: { args: ["ptr", "cstring"], returns: "ptr" },
});

const libffi = Number(sys.symbols.dlopen("/usr/lib/libffi.dylib", 1));
const libobjc = Number(sys.symbols.dlopen("/usr/lib/libobjc.A.dylib", 1));
const foundation = Number(sys.symbols.dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", 1));

const show = (label: string, p: unknown) => {
	const n = Number(p);
	console.log(`${n ? "FOUND" : "NULL "}  ${label.padEnd(46)} ${n ? `0x${BigInt(n).toString(16)}` : "-"}`);
	return n;
};

const cases: [string, number][] = [
	["RTLD_DEFAULT (-2) handle", -2],
	["libffi handle", libffi],
	["libobjc handle", libobjc],
	["Foundation handle", foundation],
];
for (const [label, h] of cases) show(`dlsym(${label}, "objc_msgSend")`, sys.symbols.dlsym(h, "objc_msgSend"));

// the whole point: if libffi's namespace already carries it, a bridge only needs one handle.
show('dlsym(libffi, "objc_getClass")', sys.symbols.dlsym(libffi, "objc_getClass"));
show('dlsym(libffi, "ffi_type_sint32")', sys.symbols.dlsym(libffi, "ffi_type_sint32"));
process.exit(0);
