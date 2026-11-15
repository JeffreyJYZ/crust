/**
 * macOS opener: `NSWorkspace` over `bun:ffi`, no native artifact. The C half is its own unit (`shim/91_opener.c` plus `shim/96_os_info.c`), because none of it needs a window and none of it belongs in the window shim's translation unit.
 * The shim's four rules apply unchanged: one fixed prototype per `objc_msgSend`, no framework header, no object and no struct across `bun:ffi`, and every path and URL arrives as bytes — a short ASCII `NSString` is a tagged pointer and cannot cross the boundary.
 * This module imports no plugin: the adapter is a plain object, and `createOpenerPlugin` accepts it structurally.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside the binary as
// text and is materialised before `cc()` sees it — the device `notifications-ffi.ts` uses.
import openerPart from "./shim/91_opener.c" with { type: "text" };
import osPart from "./shim/96_os_info.c" with { type: "text" };

/** The two halves as one translation unit: the second uses the first's `op_t` and `OP_UTF8`. */
export const openerSource = [openerPart, osPart].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const CS = FFIType.cstring;

/**
 * What each open command reports. `opened` is the only value the plugin turns into `ok: true`;
 * `notFound` is refused in TypeScript before any AppKit send, and `refused` carries the C reason,
 * which names the step that answered NO.
 */
export const OPENER_STATUS = {
	opened: 0,
	notFound: 1,
	refused: 2,
} as const;

export interface OpenerOutcome {
	/** One of `OPENER_STATUS`. */
	status: number;
	/** Why the send ended as it did, including which step refused it. */
	reason: string;
}

/** The native half as this module hands it out; `crust:opener` takes it structurally. */
export interface DarwinOpenerAdapter {
	openPath(path: string): OpenerOutcome;
	openUrl(url: string): OpenerOutcome;
	revealItem(path: string): OpenerOutcome;
}

/** The exports, as `bun:ffi` hands them back. */
export interface OpenerUnit {
	symbols: {
		crust_opener_open_path: (bytes: number, length: number) => number;
		crust_opener_open_url: (bytes: number, length: number) => number;
		crust_opener_reveal: (bytes: number, length: number) => number;
		crust_opener_reason: () => string | null;
		crust_os_version: (component: number) => number;
		crust_os_locale: () => string | null;
		crust_os_app_version: () => string | null;
		crust_os_uptime: () => number;
	};
}

function compile(): OpenerUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(openerSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-opener-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, openerSource);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "CoreFoundation"],
		symbols: {
			crust_opener_open_path: { args: [P, I64], returns: I32 },
			crust_opener_open_url: { args: [P, I64], returns: I32 },
			crust_opener_reveal: { args: [P, I64], returns: I32 },
			crust_opener_reason: { args: [], returns: CS },
			crust_os_version: { args: [I32], returns: I32 },
			crust_os_locale: { args: [], returns: CS },
			crust_os_app_version: { args: [], returns: CS },
			crust_os_uptime: { args: [], returns: FFIType.f64 },
		},
	}) as unknown as OpenerUnit;
}

let unitOnce: OpenerUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function unit(): OpenerUnit {
	return (unitOnce ??= compile());
}

/**
 * Compile the unit and report whether every export resolved. `cc()` refuses a declared symbol it
 * cannot find, so a successful compile proves all eight exist. Nothing is opened.
 */
export function openerUnitStatus(): { available: boolean; reason: string } {
	try {
		unit();
		return { available: true, reason: "compiled" };
	} catch (error) {
		return { available: false, reason: message(error) };
	}
}

// A strong reference for the duration of one send: `bun:ffi` reads the bytes during the call, and
// a local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

type OpenerCall = "crust_opener_open_path" | "crust_opener_open_url" | "crust_opener_reveal";

function outcome(name: OpenerCall, text: string): OpenerOutcome {
	let compiled: OpenerUnit;
	try {
		compiled = unit();
	} catch (error) {
		return {
			status: OPENER_STATUS.refused,
			reason: `the opener C unit did not compile: ${message(error)}`,
		};
	}
	const { address, length } = bytesOf(text);
	const opened = Number(compiled.symbols[name](address, length) ?? 0) === 1;
	const reason = String(compiled.symbols.crust_opener_reason() ?? "");
	return {
		status: opened ? OPENER_STATUS.opened : OPENER_STATUS.refused,
		reason: reason.length > 0 ? reason : `status ${opened ? "1" : "0"} with no recorded reason`,
	};
}

/** A path that is not on disk is refused here, so `-openURL:` never sees a URL it cannot open. */
function pathOutcome(name: OpenerCall, path: string): OpenerOutcome {
	if (!existsSync(path)) return { status: OPENER_STATUS.notFound, reason: `no path at ${path}` };
	return outcome(name, path);
}

/**
 * The native half of `crust:opener`. `openPath` and `revealItem` refuse a missing path before any
 * AppKit send; `openUrl` hands the string to `+[NSURL URLWithString:]`, so any scheme survives.
 */
export function darwinOpenerAdapter(): DarwinOpenerAdapter {
	return {
		openPath: (path) => pathOutcome("crust_opener_open_path", path),
		openUrl: (url) => outcome("crust_opener_open_url", url),
		revealItem: (path) => pathOutcome("crust_opener_reveal", path),
	};
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
