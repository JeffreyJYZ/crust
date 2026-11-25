/**
 * The macOS half of `window.capture`: the promise, the request id and the shim seam.
 * `-takeSnapshotWithConfiguration:completionHandler:` answers later than it is sent, on the main
 * thread the pump drives, so the adapter awaits a `JSCallback` the C unit reports through — the
 * same channel `find.ts` uses for its one BOOL. A second capture fails the first promise but cannot
 * cancel the first WebKit render, so C echoes the id of the render that completed and a stale
 * completion is dropped rather than answering the newer promise with the older window's picture.
 * The seam speaks bytes (`SnapshotBytes`), not pointers, for the reason `ClipboardShim` does: a
 * fake then proves the base64 and the size rule with no WebKit, while only `darwinSnapshotShim`
 * touches `ptr()` and the C unit.
 */

import { FFIType, JSCallback } from "bun:ffi";
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
 * The C half, named so a test can drive the adapter with a fake and wide enough that the real one
 * has the same shape. `setChannel` installs the one completion sink the process has; `take` starts
 * a render tagged with `id` and `read` collects the picture once that id's sink call arrives.
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

interface Pending {
	id: number;
	settle: (ok: boolean) => void;
	fail: (error: Error) => void;
}

let pending: Pending | undefined;
let generation = 0;

/** A capture that was already running cannot answer for the next one, so it fails rather than hangs. */
function supersede(): void {
	const previous = pending;
	pending = undefined;
	previous?.fail(new Error("crust: a second capture superseded this one before WebKit answered"));
}

/**
 * Start one snapshot and await its completion. The pending resolver is installed before the send,
 * because a handler that ran during `takeSnapshotWithConfiguration:` would otherwise be lost — and
 * on a cached page that is exactly when it runs. The id is minted here, never by C, so a completion
 * that arrives after a supersession can be recognised and discarded.
 */
export function takeSnapshot(
	view: number,
	shim: SnapshotShim = darwinSnapshotShim(),
	/** Overridable so a suite can prove the timeout without spending it. */
	timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
): Promise<WindowSnapshot> {
	supersede();
	const id = ++generation;
	return new Promise<WindowSnapshot>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		pending = {
			id,
			settle: (ok) => {
				done();
				if (!ok) {
					reject(
						new Error(
							`crust: window.capture: ${snapshotStartReason(SNAPSHOT_STATUS.noPicture)}`,
						),
					);
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
		shim.setChannel((answerId, ok) => {
			// A completion from a superseded render must not settle the live promise with the
			// superseded render's picture, width, height or scale.
			if (answerId !== pending?.id) return;
			const answer = pending;
			pending = undefined;
			answer.settle(ok);
		});
		const status = shim.take(view, id);
		if (pending !== undefined && status !== SNAPSHOT_STATUS.started) {
			done();
			pending = undefined;
			reject(
				new Error(`crust: window.capture did not start: ${snapshotStartReason(status)}`),
			);
			return;
		}
		timer = setTimeout(() => {
			if (pending === undefined) return;
			pending = undefined;
			reject(
				new Error(
					`crust: window.capture: ${snapshotStartReason(SNAPSHOT_STATUS.noCompletion)} ` +
						`(waited ${timeoutMs} ms)`,
				),
			);
		}, timeoutMs);
	});
}
