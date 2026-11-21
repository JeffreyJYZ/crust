/**
 * The native symbols WebKitGTK's page snapshot needs, split out of `shim-ffi.ts` at the file cap.
 * All are optional: a fake shim need not carry them, and an older WebKitGTK answers `ready() === 0`
 * with `shim_lib_error_text` naming the entry point it lacks. The callback fills the picture before
 * `state()` leaves 0, so a reader that sees 1 has all of the PNG bytes.
 */
export interface SnapshotSymbols {
	shim_snapshot_ready?(): number;
	/** 0 started, 1 no API, 2 no view, 3 view not realised. */
	shim_snapshot_take?(web: bigint): number;
	/** 0 pending, 1 picture, 2 refusal. */
	shim_snapshot_state?(): number;
	shim_snapshot_failure?(): string | null;
	shim_snapshot_width?(): number;
	shim_snapshot_height?(): number;
	shim_snapshot_scale?(): number;
	shim_snapshot_length?(): number;
	/** Length first, then an exact-size copy into `dst`. */
	shim_snapshot_read?(dst: Uint8Array, cap: number): number;
}
