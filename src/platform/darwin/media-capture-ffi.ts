/**
 * The media-capture unit's C boundary: `shim/122_media_capture.c` compiled by `cc()` with AppKit,
 * Foundation and WebKit linked by name. It is its own unit rather than a part of the shared shim
 * for the same reason `find` is: it installs a runtime `WKUIDelegate`, and the statics that
 * remember the grant belong to one translation unit, not to every window's code.
 *
 * A compiled binary cannot read `import.meta.dir`, so the C travels inside it as text and is
 * materialised before `cc()` sees it — the device `dock-ffi.ts` uses.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import mediaPart from "./shim/122_media_capture.c" with { type: "text" };

export const mediaCaptureSource = mediaPart;

const P = FFIType.ptr;
const I32 = FFIType.i32;

/** The exports, as `bun:ffi` hands them back. */
export interface MediaCaptureNative {
	symbols: {
		shim_media_capture_install: (web: number, grant: number) => number;
		shim_media_capture_installed: (web: number) => number;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(mediaCaptureSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-media-capture-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, mediaCaptureSource);
	return file;
}

function compile(): MediaCaptureNative {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			shim_media_capture_install: { args: [P, I32], returns: I32 },
			shim_media_capture_installed: { args: [P], returns: I32 },
		},
	}) as unknown as MediaCaptureNative;
}

let unitOnce: MediaCaptureNative | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function mediaCaptureUnit(): MediaCaptureNative {
	return (unitOnce ??= compile());
}
