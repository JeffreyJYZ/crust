#!/usr/bin/env bun
// Is Bun's JavaScript thread the OS main thread? Everything in DESIGN.md §3
// assumes it is. One FFI call answers it, with no AppKit involved.
import { dlopen, FFIType } from "bun:ffi";

const lib = dlopen("/usr/lib/libSystem.B.dylib", {
	pthread_main_np: { args: [], returns: FFIType.i32 },
	pthread_self: { args: [], returns: FFIType.ptr },
	getpid: { args: [], returns: FFIType.i32 },
});

const main = lib.symbols.pthread_main_np();
const self = lib.symbols.pthread_self();

console.log(`pthread_main_np      -> ${main} (1 means this thread IS the main thread)`);
console.log(`pthread_self         -> ${Number(self)}`);
console.log(`pid                  -> ${lib.symbols.getpid()}`);

// Same check from inside a timer, when AppKit work is normally done.
setTimeout(() => {
	console.log(`in setTimeout: main  -> ${lib.symbols.pthread_main_np()}`);
	process.exit(0);
}, 0);
