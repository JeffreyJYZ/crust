/** bun:ffi table for the AppKit-only floor probe. The C unit is startup-bare.m. */
import { cc, FFIType } from "bun:ffi";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import source from "./startup-bare.c" with { type: "text" };

export interface BareNative {
	bare_create: (
		width: number,
		height: number,
		flags: number,
		a: Uint8Array,
		b: Uint8Array,
	) => number;
	bare_load_sync: () => void;
	bare_load_html: (html: Uint8Array) => void;
	bare_load_url: (url: Uint8Array) => void;
	bare_pump: () => void;
	bare_done: () => number;
	bare_destroy: () => void;
}

let table: BareNative | undefined;

export function bareNative(): BareNative {
	if (table) return table;
	const path = join(mkdtempSync(join(tmpdir(), "crust-bare-")), "bare.c");
	writeFileSync(path, source);
	table = cc({
		source: path,
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			bare_create: {
				args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.cstring, FFIType.cstring],
				returns: FFIType.cstring,
			},
			bare_load_sync: { args: [], returns: FFIType.void },
			bare_load_html: { args: [FFIType.cstring], returns: FFIType.void },
			bare_load_url: { args: [FFIType.cstring], returns: FFIType.void },
			bare_pump: { args: [], returns: FFIType.void },
			bare_done: { args: [], returns: FFIType.i32 },
			bare_destroy: { args: [], returns: FFIType.void },
		},
	}).symbols as unknown as BareNative;
	return table;
}
