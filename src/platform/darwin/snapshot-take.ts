/**
 * The promise half of `window.capture`: one in-flight id, one completion sink, and the opt-in's
 * scoped private-SPI toggle. Split from `snapshot.ts` so neither file passes the line cap. C echoes
 * the id of the render it finished, so a completion from a superseded capture is dropped rather
 * than answering the newer promise with the older window's picture.
 */
import type { WindowSnapshot } from "@/plugins/window-types.ts";
import {
	darwinSnapshotShim,
	type SnapshotOptions,
	type SnapshotShim,
	SNAPSHOT_STATUS,
	snapshotStartReason,
	OCCLUSION_UNAVAILABLE,
	SNAPSHOT_TIMEOUT_MS,
	snapshotFrom,
} from "./snapshot.ts";

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
	options: SnapshotOptions = {},
): Promise<WindowSnapshot> {
	supersede();
	const id = ++generation;
	const override = options.ignoreOcclusion === true;
	if (override) {
		if (typeof shim.occlusion !== "function") {
			return Promise.reject(
				new Error("crust: window.capture ignoreOcclusion needs an occlusion-capable shim"),
			);
		}
		// A WebKit update can remove the private selector. Refuse by name before sending, so the
		// caller gets a status rather than a stalled capture or a crash.
		if (shim.occlusion(view, false) !== true) {
			return Promise.reject(new Error(OCCLUSION_UNAVAILABLE));
		}
	}
	return new Promise<WindowSnapshot>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let restored = false;
		/** Every terminal path calls this, so the flag never outlives one capture. */
		const done = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			if (override && !restored) {
				restored = true;
				shim.occlusion?.(view, true);
			}
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
		let status: number;
		try {
			shim.setChannel((answerId, ok) => {
				// A completion from a superseded render must not settle the live promise with the
				// superseded render's picture, width, height or scale.
				if (answerId !== pending?.id) return;
				const answer = pending;
				pending = undefined;
				answer.settle(ok);
			});
			status = shim.take(view, id);
		} catch (error) {
			done();
			pending = undefined;
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
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
			done();
			reject(
				new Error(
					`crust: window.capture: ${snapshotStartReason(SNAPSHOT_STATUS.noCompletion)} ` +
						`(waited ${timeoutMs} ms)`,
				),
			);
		}, timeoutMs);
	});
}
