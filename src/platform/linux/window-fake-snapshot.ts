/**
 * The snapshot half of the fake Linux shim, split out at the file cap. The fake answers
 * synchronously: `take` records the view and `state` is already 1, so `takeLinuxSnapshot` reads a
 * complete picture on its first poll. `realised: false` makes `take` answer the named status a real
 * GTK would for a view it has not mapped yet.
 */
import type { LinuxShim } from "./shim-ffi.ts";

/** A non-empty stand-in for the PNG bytes cairo would write: PNG signature plus filler. */
export const SNAP_PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

export type SnapshotFake = Pick<
	LinuxShim,
	| "shim_snapshot_ready"
	| "shim_snapshot_take"
	| "shim_snapshot_state"
	| "shim_snapshot_failure"
	| "shim_snapshot_width"
	| "shim_snapshot_height"
	| "shim_snapshot_scale"
	| "shim_snapshot_length"
	| "shim_snapshot_read"
>;

export function snapshotFake(realised: boolean, captures: number[]): SnapshotFake {
	return {
		shim_snapshot_ready: () => 1,
		shim_snapshot_take: (web) => {
			if (!realised) return 3; // SHOT_NOT_REALISED
			captures.push(Number(web));
			return 0; // SHOT_STARTED; the answer is already ready in the fake
		},
		shim_snapshot_state: () => 1,
		shim_snapshot_failure: () => "",
		shim_snapshot_width: () => 320,
		shim_snapshot_height: () => 200,
		shim_snapshot_scale: () => 1,
		shim_snapshot_length: () => SNAP_PNG.length,
		shim_snapshot_read: (dst, cap) => {
			const n = Math.min(cap, SNAP_PNG.length);
			for (let i = 0; i < n; i++) dst[i] = SNAP_PNG[i] as number;
			return SNAP_PNG.length;
		},
	};
}
