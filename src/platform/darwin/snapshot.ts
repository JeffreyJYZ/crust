/**
 * The macOS half of `window.capture`: the byte seam, the promise's public surface and the shim.
 * `-takeSnapshotWithConfiguration:completionHandler:` answers later than it is sent, on the main
 * thread the pump drives, so the adapter awaits a `JSCallback` the C unit reports through — the
 * same channel `find.ts` uses for its one BOOL. The seam speaks bytes (`SnapshotBytes`), not
 * pointers, for the reason `ClipboardShim` does: a fake proves the base64 and the size rule with no
 * WebKit, while only `darwinSnapshotShim` touches pointers and the C unit.
 * The promise and its one-capture occlusion scope live in `snapshot-take.ts`, re-exported here so
 * every caller keeps one import.
 */

import { FFIType, JSCallback } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WindowSnapshot } from "@/plugins/window-types.ts";
import {
	type SnapshotNative,
	SNAPSHOT_STATUS,
	snapshotStartReason,
	snapshotUnit,
	snapshotUnitStatus,
} from "./snapshot-unit.ts";
import { readShot, type SnapshotBytes } from "./snapshot-read.ts";

export { SNAPSHOT_STATUS, snapshotStartReason, snapshotUnit, snapshotUnitStatus };
export { takeSnapshot } from "./snapshot-take.ts";
export type { SnapshotNative, SnapshotUnit } from "./snapshot-unit.ts";
export type { SnapshotBytes } from "./snapshot-read.ts";

const I32 = FFIType.i32;

/**
 * How long a capture may stay unanswered. WebKit calls the completion handler on the main thread;
 * a promise that outlives this is reported rather than left hanging, because a page awaiting it
 * would never learn anything.
 */
export const SNAPSHOT_TIMEOUT_MS = 5000;

/**
 * A WebKit update that drops `_setWindowOcclusionDetectionEnabled:` answers this, not a crash and
 * not a stalled capture. Named so a probe can branch on the one unsupported-SPI failure.
 */
export const OCCLUSION_UNAVAILABLE =
	"crust: window.capture ignoreOcclusion: unsupported WebKit " +
	"_setWindowOcclusionDetectionEnabled: is absent on this macOS; no capture was started";

/**
 * `prime` names the same refusal in both cases: an installed bundle, and a future macOS without
 * the private NSWindow selector. Nothing is sent before this answer, so a caller never waits out a
 * 5 s budget to learn that the harness-only path is gone.
 */
export const PRIME_UNAVAILABLE =
	"crust: window.capture prime-unavailable: the harness-only composited-bit override " +
	"cannot be used here; no capture was started";

/**
 * The same guard the shim audit uses: NODE_ENV production, or no shim sources on disk, means this
 * is an installed app whose C files travel as text inside the binary. `prime` is harness-only and
 * must never become reachable there; this is checked before any private send.
 */
export function primeAvailable(): boolean {
	if (process.env.NODE_ENV === "production") return false;
	return existsSync(join(import.meta.dir, "shim", "10_prelude.c"));
}

/**
 * The opt-in a probe passes to `window.capture`. `ignoreOcclusion` says what the caller wants —
 * a picture of a view WebKit considers occluded — without naming the private selector behind it.
 * Absent means today's behaviour: no SPI call, no change to WebKit's rendering for the app.
 */
export interface SnapshotOptions {
	/**
	 * Disable WebKit's window-occlusion detection for the length of this one capture, then restore
	 * WebKit's default. Unsupported WebKit SPI; for automated probes whose window may be off-Space,
	 * never for a shipped app's casual screenshots. When the selector is absent the capture answers
	 * a named failure instead of crashing.
	 */
	ignoreOcclusion?: boolean;
	/**
	 * HARNESS ONLY. Force AppKit's composited bit on this webview's window for one capture, then
	 * restore it in a `finally`. An automated probe whose accessory app never activates cannot get
	 * that bit set by any public API; a shipped app should show or activate its window instead.
	 * Refused by name in a production bundle or when the private selector is absent.
	 */
	prime?: boolean;
}

/**
 * The C half, named so a test can drive the adapter with a fake and wide enough that the real one
 * has the same shape. `setChannel` installs the one completion sink the process has; `take` starts
 * a render tagged with `id` and `read` collects the picture once that id's sink call arrives.
 * `occlusion` is the opt-in's private-SPI seam; optional so an ordinary fake stays valid.
 */
export interface SnapshotShim {
	/** Whether this webview can render a picture at all. */
	available(view: number): boolean;
	/** `SNAPSHOT_STATUS`: only `started` means a picture is on its way. */
	take(view: number, id: number): number;
	/** The finished picture; throws when there is none or the copy came back short. */
	read(): SnapshotBytes;
	/** Where the completion handler reports: the render's id and 1 for a picture, 0 for a refusal. */
	setChannel(onAnswer: (id: number, ok: boolean) => void): void;
	/** Unsupported WebKit SPI: 1 when the selector existed, else 0. `false` restores the default. */
	occlusion?(view: number, enabled: boolean): boolean;
	/** Private, harness-only NSWindow SPI: 1 when `_setOcclusionStateIsVisible:` exists. */
	primeAvailable?(view: number): boolean;
	/** Set or clear the composited bit; 1 only when the private selector existed. */
	prime?(view: number, enabled: boolean): boolean;
	/** Public `occlusionState` bit 2, so a test can prove the bit was restored. */
	composited?(view: number): boolean;
}

/** One sink per process: C keeps a single function pointer, so a second JSCallback is never reached. */
let sink: JSCallback | undefined;
let listener: ((id: number, ok: boolean) => void) | undefined;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** The real shim: the unit compiles on the first capture, never when this object is built. */
export function darwinSnapshotShim(): SnapshotShim {
	const symbols = () => snapshotUnit().symbols;
	return {
		available: (view) => Number(symbols().crust_shot_available(view) ?? 0) === 1,
		take: (view, id) =>
			Number(symbols().crust_shot_take(view, id) ?? SNAPSHOT_STATUS.unavailable),
		read: () => readShot(symbols()),
		occlusion: (view, enabled) =>
			Number(symbols().crust_shot_occlusion(view, enabled ? 1 : 0) ?? 0) === 1,
		primeAvailable: (view) => Number(symbols().crust_shot_prime_available(view) ?? 0) === 1,
		prime: (view, enabled) =>
			Number(symbols().crust_shot_prime(view, enabled ? 1 : 0) ?? 0) === 1,
		composited: (view) => Number(symbols().crust_shot_composited(view) ?? 0) === 1,
		setChannel: (onAnswer) => {
			listener = onAnswer;
			if (sink === undefined) {
				sink = new JSCallback(
					(id: number, ok: number) => {
						listener?.(id, Number(ok) === 1);
						return 0;
					},
					{ args: [I32, I32], returns: I32 },
				);
			}
			symbols().crust_shot_set_sink(callbackPointer(sink));
		},
	};
}

/** The page's answer: base64 text and three numbers a page can size an `<img>` by. */
export function snapshotFrom(bytes: SnapshotBytes): WindowSnapshot {
	const { width, height, scale } = bytes;
	if (!(width > 0) || !(height > 0) || !(scale > 0)) {
		throw new Error(
			`crust: window.capture measured ${width}x${height} at scale ${scale}, which is not a picture`,
		);
	}
	if (bytes.png.length === 0) throw new Error("crust: window.capture produced an empty PNG");
	return { width, height, scale, png: Buffer.from(bytes.png).toString("base64") };
}
