/**
 * The find C unit: `shim/108_find.c`, compiled at launch by `cc()`. It builds a GLOBAL block
 * for `-findString:withConfiguration:completionHandler:`, because a block may not cross
 * `bun:ffi`, and reports the one BOOL it carries through a `JSCallback`.
 * `WKFindResult` has `-matchFound` and no count, and `WKFindConfiguration` has no
 * `findNext`/`findPrevious`, so this unit starts a search and repeats it; advancing is the
 * adapter's job and the private `-_clearFindIndicator` is never sent from here.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside the
// binary as text and is materialised before `cc()` sees it.
import blockPart from "./shim/108_find.c" with { type: "text" };
import idPart from "./shim/109_find_ids.c" with { type: "text" };
import { auditFlags, auditSource, auditSymbols } from "./shim-audit.ts";

const source = auditSource(`${blockPart}\n${idPart}`);

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const V = FFIType.void;

/** `crust_find_search`'s answers; `started` is the only one a caller accepts. */
export const FIND_STATUS = {
	started: 0,
	unavailable: 1,
	noObject: 2,
	noBlock: 3,
} as const;

const REASONS: Record<number, string> = {
	[FIND_STATUS.unavailable]:
		"the webview is missing, or has no findString:withConfiguration:completionHandler:",
	[FIND_STATUS.noObject]: "the search text or the WKFindConfiguration did not build",
	[FIND_STATUS.noBlock]: "the completion block could not be built",
};

/** Why a search answered what it did, including a status this build does not know. */
export function findStartReason(status: number): string {
	return REASONS[status] ?? `unknown status ${status} while starting a find`;
}

/** The exports, as `bun:ffi` hands them back; `FindNative` is the seam a fake replaces. */
export interface FindUnit {
	symbols: {
		crust_find_set_sink: (sink: number) => void;
		crust_find_available: (web: number) => number;
		crust_find_search: (
			web: number,
			bytes: number,
			length: number,
			backwards: number,
			caseSensitive: number,
			id: number,
		) => number;
		crust_find_repeat: (web: number, backwards: number, caseSensitive: number) => number;
		/** 1 when the global completion block is built. */
		crust_find_block_ready: () => number;
	};
}

export type FindNative = FindUnit["symbols"];

function compile(): FindUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-find-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, source);
	return cc({
		source: file,
		flags: [
			"-framework",
			"AppKit",
			"-framework",
			"Foundation",
			"-framework",
			"WebKit",
			...auditFlags(),
		],
		symbols: {
			...auditSymbols,
			crust_find_set_sink: { args: [P], returns: V },
			crust_find_available: { args: [P], returns: I32 },
			crust_find_search: { args: [P, P, I64, I32, I32, I32], returns: I32 },
			crust_find_repeat: { args: [P, I32, I32], returns: I32 },
			crust_find_block_ready: { args: [], returns: I32 },
		},
	}) as unknown as FindUnit;
}

let unitOnce: FindUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function findUnit(): FindUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: find in page needs WebKit, and this is ${process.platform}`);
	}
	return (unitOnce ??= compile());
}
