/**
 * The dock tile's C boundary: `shim/104_dock.c` compiled by `cc()` with AppKit, Foundation and
 * CoreFoundation linked by name — no artifact, no Xcode, no header.
 * The shim's four rules live here: one fixed prototype per `objc_msgSend`, no framework header, no
 * object and no struct across `bun:ffi`, and every string arriving as bytes. This file only knows
 * symbols and buffers; what a badge means belongs to `dock.ts`.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside it as text and
// is materialised before `cc()` sees it — the device `platform/darwin/opener.ts` uses.
import dockPart from "./shim/104_dock.c" with { type: "text" };

export const dockSource = dockPart;

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const CS = FFIType.cstring;

/** Every symbol the unit declares, so a probe can prove the whole set resolved. */
export const DOCK_SYMBOL_NAMES = [
	"crust_dock_abi",
	"crust_dock_reason",
	"crust_dock_bounce_kind",
	"crust_dock_set_badge",
	"crust_dock_badge_label",
	"crust_dock_bounce",
	"crust_dock_set_progress",
] as const;

/** The exports, as `bun:ffi` hands them back. */
export interface DockUnit {
	symbols: {
		crust_dock_abi: () => number;
		crust_dock_reason: () => string | null;
		crust_dock_bounce_kind: (critical: number) => number;
		crust_dock_set_badge: (bytes: number, length: number) => number;
		crust_dock_badge_label: () => string | null;
		crust_dock_bounce: (critical: number) => number;
		crust_dock_set_progress: (value: number) => number;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(dockSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-dock-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, dockSource);
	return file;
}

function compile(): DockUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "CoreFoundation"],
		symbols: {
			crust_dock_abi: { args: [], returns: I32 },
			crust_dock_reason: { args: [], returns: CS },
			crust_dock_bounce_kind: { args: [I32], returns: I32 },
			crust_dock_set_badge: { args: [P, I64], returns: I32 },
			crust_dock_badge_label: { args: [], returns: CS },
			crust_dock_bounce: { args: [I32], returns: I64 },
			crust_dock_set_progress: { args: [F64], returns: I32 },
		},
	}) as unknown as DockUnit;
}

let unitOnce: DockUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function dockUnit(): DockUnit {
	return (unitOnce ??= compile());
}

/** Whether the unit compiled and every declared export resolved. Nothing is sent. */
export function dockUnitStatus(): { available: boolean; reason: string } {
	try {
		const compiled = dockUnit();
		return Number(compiled.symbols.crust_dock_abi()) === 1
			? { available: true, reason: "compiled" }
			: { available: false, reason: "crust_dock_abi did not answer 1" };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

// A strong reference for the duration of one send: `bun:ffi` reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

/** A JS string as the byte range the C side builds an `NSString` from. */
export function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	// `ptr()` refuses a zero-length array, and an empty label is the documented way to clear a badge,
	// so it goes to C as a null pointer with length 0 — which is what `initWithBytes:length:` reads
	// as an empty string and what `setBadgeLabel:` reads as "no badge".
	if (bytes.length === 0) return { address: 0, length: 0 };
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}
