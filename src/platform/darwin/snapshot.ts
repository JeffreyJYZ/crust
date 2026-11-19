/**
 * The macOS half of `window.capture`: the promise, the two-pass PNG marshal and the shim seam.
 * `-takeSnapshotWithConfiguration:completionHandler:` answers later than it is sent, on the main
 * thread the pump drives, so the adapter awaits a `JSCallback` the C unit reports through — the
 * same channel `find.ts` uses for its one BOOL.
 * The seam speaks bytes (`SnapshotBytes`), not pointers, for the reason `ClipboardShim` does: a
 * fake then proves the base64 and the size rule with no WebKit, while only `darwinSnapshotShim`
 * touches `ptr()` and the C unit.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";
import type { WindowSnapshot } from "@/plugins/window-types.ts";
import {
	type SnapshotNative,
	SNAPSHOT_STATUS,
	snapshotStartReason,
	snapshotUnit,
	snapshotUnitStatus,
} from "./snapshot-unit.ts";

export { SNAPSHOT_STATUS, snapshotStartReason, snapshotUnit, snapshotUnitStatus };
export type { SnapshotNative, SnapshotUnit } from "./snapshot-unit.ts";

const I32 = FFIType.i32;

/**
 * How long a capture may stay unanswered. WebKit calls the completion handler on the main thread;
 * a promise that outlives this is reported rather than left hanging, because a page awaiting it
 * would never learn anything.
 */
export const SNAPSHOT_TIMEOUT_MS = 5000;

/** What the C unit left behind: raw PNG bytes and the numbers measured from them. */
export interface SnapshotBytes {
	width: number;
	height: number;
	scale: number;
	png: Uint8Array;
}

/**
 * The C half, named so a test can drive the adapter with a fake and wide enough that the real one
 * has the same shape. `setChannel` installs the one completion sink the process has; `take` starts
 * a render and `read` collects it once that sink says the render finished.
 */
export interface SnapshotShim {
	/** Whether this webview can render a picture at all. */
	available(view: number): boolean;
	/** `SNAPSHOT_STATUS`: only `started` means a picture is on its way. */
	take(view: number): number;
	/** The finished picture; throws when there is none or the copy came back short. */
	read(): SnapshotBytes;
	/** Where the completion handler reports: 1 for a picture, 0 for a refusal. */
	setChannel(onAnswer: (ok: boolean) => void): void;
}

/** One sink per process: C keeps a single function pointer, so a second JSCallback is never reached. */
let sink: JSCallback | undefined;
let listener: ((ok: boolean) => void) | undefined;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** Length first, then a buffer of exactly that size: one pass either truncates or copies a race. */
function readShot(symbols: SnapshotNative): SnapshotBytes {
	const length = Number(symbols.crust_shot_length() ?? -1);
	if (!Number.isFinite(length) || length <= 0) {
		throw new Error("crust: window.capture produced no PNG bytes");
	}
	const buffer = new Uint8Array(length);
	const copied = Number(symbols.crust_shot_read(ptr(buffer), buffer.length) ?? -1);
	if (copied !== length) {
		throw new Error(`crust: window.capture read ${copied} of ${length} PNG bytes`);
	}
	return {
		width: Number(symbols.crust_shot_width() ?? 0),
		height: Number(symbols.crust_shot_height() ?? 0),
		scale: Number(symbols.crust_shot_scale() ?? 0),
		png: buffer,
	};
}

/** The real shim: the unit compiles on the first capture, never when this object is built. */
export function darwinSnapshotShim(): SnapshotShim {
	const symbols = () => snapshotUnit().symbols;
	return {
		available: (view) => Number(symbols().crust_shot_available(view) ?? 0) === 1,
		take: (view) => Number(symbols().crust_shot_take(view) ?? SNAPSHOT_STATUS.unavailable),
		read: () => readShot(symbols()),
		setChannel: (onAnswer) => {
			listener = onAnswer;
			if (sink === undefined) {
				sink = new JSCallback(
					(ok: number) => {
						listener?.(Number(ok) === 1);
						return 0;
					},
					{ args: [I32], returns: I32 },
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

let pending: { settle: (ok: boolean) => void; fail: (error: Error) => void } | undefined;

/** A capture that was already running cannot answer for the next one, so it fails rather than hangs. */
function supersede(): void {
	const previous = pending;
	pending = undefined;
	previous?.fail(new Error("crust: a second capture superseded this one before WebKit answered"));
}

/**
 * Start one snapshot and await the completion handler. The pending resolver is installed before
 * the send, because a handler that ran during `takeSnapshotWithConfiguration:` would otherwise be
 * lost — and on a cached page that is exactly when it runs.
 */
export function takeSnapshot(
	view: number,
	shim: SnapshotShim = darwinSnapshotShim(),
	/** Overridable so a suite can prove the timeout without spending it. */
	timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
): Promise<WindowSnapshot> {
	supersede();
	return new Promise<WindowSnapshot>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		pending = {
			settle: (ok) => {
				done();
				if (!ok) {
					reject(new Error("crust: WebKit took no snapshot — the view rendered nothing"));
					return;
				}
				try {
					resolve(snapshotFrom(shim.read()));
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			},
			fail: (reason) => {
				done();
				reject(reason);
			},
		};
		shim.setChannel((ok) => {
			const answer = pending;
			pending = undefined;
			answer?.settle(ok);
		});
		const status = shim.take(view);
		if (pending !== undefined && status !== SNAPSHOT_STATUS.started) {
			done();
			pending = undefined;
			reject(new Error(`crust: window.capture did not start: ${snapshotStartReason(status)}`));
			return;
		}
		timer = setTimeout(() => {
			if (pending === undefined) return;
			pending = undefined;
			reject(
				new Error(
					`crust: the snapshot completion handler did not answer within ${timeoutMs} ms`,
				),
			);
		}, timeoutMs);
	});
}
