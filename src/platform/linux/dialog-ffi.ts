/**
 * The Linux file panels' entry points, as `bun:ffi` sees them. Split out of `shim-ffi.ts` at the
 * line cap, and along a real seam: these are the one namespace that is resolved lazily and can be
 * absent (GtkFileChooserNative is GTK 3.20), so every member is optional and the gate is
 * `shim_dialog_ready` with `shim_dialog_missing` naming what was absent.
 *
 * `status` is 0 idle, 1 pending, 2 accepted, 3 cancelled — read between pump slices, on the thread
 * GTK answers on. `open`/`save` answer 1 started, -2 an entry point is absent, -3 GTK refused.
 */
export interface LinuxDialogShim {
	shim_dialog_ready?(): number;
	shim_dialog_missing?(): string | null;
	shim_dialog_open?(
		title: Uint8Array,
		filters: Uint8Array,
		multiple: number,
		directory: number,
		parent: bigint,
	): number;
	shim_dialog_save?(
		title: Uint8Array,
		suggested: Uint8Array,
		filters: Uint8Array,
		parent: bigint,
	): number;
	shim_dialog_status?(): number;
	shim_dialog_count?(): number;
	shim_dialog_path?(index: number): string | null;
	/** 1 ended a pending panel, 0 when nothing was pending — a race, never an error. */
	shim_dialog_cancel?(): number;
	/** Destroy the panel that is up; safe when none is. */
	shim_dialog_release?(): void;
}
