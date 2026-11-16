/**
 * Compile the downloads C unit, once per process. It ships as four parts so none outgrows the line
 * cap, but it is **one translation unit**: the parts share statics (`dl_downloads`, `dl_text`, the
 * delegate instance), and a static is private to its unit, so compiling them separately would give
 * each its own copy and the delegate would report into a table nobody reads. They are concatenated
 * here, in declaration order, and handed to `cc()` as text — a compiled binary has no readable
 * `import.meta.dir`, so the source travels inside it.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import api from "./shim/downloads/30_api.c" with { type: "text" };
import block from "./shim/downloads/10_block.c" with { type: "text" };
import delegate from "./shim/downloads/20_delegate.c" with { type: "text" };
import prelude from "./shim/downloads/00_prelude.c" with { type: "text" };

/** The whole unit as C source, in declaration order. */
export const downloadsSource = [prelude, block, delegate, api].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;
const CS = FFIType.cstring;

export interface DownloadsUnit {
	symbols: {
		dl_abi: () => number;
		dl_install: (sink: number) => number;
		dl_start: (web: number, bytes: number, length: number) => number | bigint;
		dl_cancel: (token: number) => number;
		dl_forget: (token: number) => void;
		dl_progress: (token: number) => number;
		dl_answer: (bytes: number, length: number) => void;
		dl_text_copy: () => string | null;
		dl_last_token_get: () => number | bigint;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's per-path cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(downloadsSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-downloads-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, downloadsSource);
	return path;
}

function compile(): DownloadsUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			dl_abi: { args: [], returns: I32 },
			dl_install: { args: [P], returns: I32 },
			dl_start: { args: [P, P, I64], returns: I64 },
			dl_cancel: { args: [I64], returns: I32 },
			dl_forget: { args: [I64], returns: V },
			dl_progress: { args: [I64], returns: F64 },
			dl_answer: { args: [P, I64], returns: V },
			dl_text_copy: { args: [], returns: CS },
			dl_last_token_get: { args: [], returns: I64 },
		},
	}) as unknown as DownloadsUnit;
}

let unitOnce: DownloadsUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function downloadsUnit(): DownloadsUnit {
	return (unitOnce ??= compile());
}
