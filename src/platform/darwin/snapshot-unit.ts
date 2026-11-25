/**
 * The snapshot C unit: `shim/123_snapshot.c` plus its reads in `shim/124_snapshot_read.c`, compiled
 * together at first capture by `cc()` — one unit, because the reads live on the statics the
 * completion handler fills. It builds a GLOBAL block for
 * `-[WKWebView takeSnapshotWithConfiguration:completionHandler:]`, which is how a block crosses
 * into WebKit at all, and the picture itself never leaves C: the handler encodes PNG bytes, keeps
 * them, and reports the length so the caller can copy into an exact-size buffer, exactly as the
 * clipboard image unit does.
 * Nothing here reads the display, so no Screen Recording grant is involved.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C parts travel inside it as text.
import blockPart from "./shim/123_snapshot.c" with { type: "text" };
import idPart from "./shim/125_snapshot_ids.c" with { type: "text" };
import readPart from "./shim/124_snapshot_read.c" with { type: "text" };

export const snapshotSource = `${blockPart}\n${idPart}\n${readPart}`;

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;

/** `crust_shot_take`'s answers; `started` is the only one a caller accepts. */
export const SNAPSHOT_STATUS = {
	started: 0,
	unavailable: 1,
	noConfig: 2,
	noBlock: 3,
	/**
	 * The render was sent but WebKit never called the completion handler. Measured on macOS 27 for
	 * a window ordered front at -4000,-4000 that had never been composited: the page keeps running,
	 * `takeSnapshot` starts, and no answer ever arrives. `createPDFWithConfiguration:` stalls in the
	 * same state, so there is no picture to fall back to — the caller needs this name, not a wait.
	 */
	noCompletion: 4,
	/** WebKit called back with no image: the view rendered nothing. */
	noPicture: 5,
} as const;

const REASONS: Record<number, string> = {
	[SNAPSHOT_STATUS.unavailable]:
		"the webview is missing, or has no takeSnapshotWithConfiguration:completionHandler:",
	[SNAPSHOT_STATUS.noConfig]: "WKSnapshotConfiguration did not build",
	[SNAPSHOT_STATUS.noBlock]: "the completion block could not be built",
	[SNAPSHOT_STATUS.noCompletion]:
		"WebKit never called the snapshot completion handler: this view has no composited picture (an offscreen window that has never been shown), so window.capture cannot produce a PNG; show the window so WebKit composites it, then retry",
	[SNAPSHOT_STATUS.noPicture]:
		"WebKit answered the snapshot with no image: the view rendered nothing",
};

/** Why a capture answered what it did, including a status this build does not know. */
export function snapshotStartReason(status: number): string {
	return REASONS[status] ?? `unknown status ${status} while starting a snapshot`;
}

/** The exports, as `bun:ffi` hands them back; `SnapshotNative` is the seam a fake replaces. */
export interface SnapshotUnit {
	symbols: {
		crust_shot_set_sink: (sink: number) => void;
		crust_shot_available: (web: number) => number;
		crust_shot_take: (web: number, id: number) => number;
		/** Unsupported WebKit SPI: 1 when the occlusion-toggle selector existed, else 0. */
		crust_shot_occlusion: (web: number, enabled: number) => number;
		crust_shot_width: () => number;
		crust_shot_height: () => number;
		crust_shot_scale: () => number;
		crust_shot_length: () => number;
		crust_shot_read: (dst: number, cap: number) => number;
		crust_shot_block_ready: () => number;
	};
}

export type SnapshotNative = SnapshotUnit["symbols"];

function compile(): SnapshotUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	const hash = createHash("sha256").update(snapshotSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-snapshot-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, snapshotSource);
	return cc({
		source: file,
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			crust_shot_set_sink: { args: [P], returns: V },
			crust_shot_available: { args: [P], returns: I32 },
			crust_shot_take: { args: [P, I32], returns: I32 },
			crust_shot_occlusion: { args: [P, I32], returns: I32 },
			crust_shot_width: { args: [], returns: I64 },
			crust_shot_height: { args: [], returns: I64 },
			crust_shot_scale: { args: [], returns: F64 },
			crust_shot_length: { args: [], returns: I64 },
			crust_shot_read: { args: [P, I64], returns: I64 },
			crust_shot_block_ready: { args: [], returns: I32 },
		},
	}) as unknown as SnapshotUnit;
}

let unitOnce: SnapshotUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms and runs on the first capture. */
export function snapshotUnit(): SnapshotUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: window.capture needs WebKit, and this is ${process.platform}`);
	}
	return (unitOnce ??= compile());
}

/** Whether the unit compiles and the completion block builds, proved with no window. */
export function snapshotUnitStatus(): { available: boolean; reason: string } {
	try {
		const { symbols } = snapshotUnit();
		const ready = Number(symbols.crust_shot_block_ready() ?? 0) === 1;
		return ready
			? { available: true, reason: "compiled" }
			: { available: false, reason: "the global completion block did not build" };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
