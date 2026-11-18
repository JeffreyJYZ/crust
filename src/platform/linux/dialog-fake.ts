/**
 * The dialog symbols a test drives, on top of the existing window fake so one table satisfies
 * `LinuxShim` and a test never restates thirty members to reach nine.
 *
 * The status is a property rather than a scripted answer: the adapter's wait reads it on a timer, so
 * a test sets it to `accepted` or `cancelled` and the next read sees the human's answer. That is the
 * only way to model a modal on a machine with no display server.
 */
import { uncstring } from "./cstring.ts";
import type { LinuxShim } from "./shim-ffi.ts";
import { fakeWindowShim } from "./window-fake.ts";

export interface FakeDialogOptions {
	/** false models a GTK too old for GtkFileChooserNative. */
	ready?: boolean;
	/** The entry point `shim_dialog_missing` names when not ready. */
	missing?: string;
	/** What `shim_dialog_open`/`shim_dialog_save` answer; defaults to 1, started. */
	start?: number;
	/** The paths an accepted panel answers with. */
	paths?: string[];
}

export interface FakeDialog {
	symbols: LinuxShim;
	/** Every dialog call, as `name:arguments…`, in the order the adapter made it. */
	calls: string[];
	/** The status the wait reads; writable so a test plays the human. */
	status: number;
	paths: string[];
}

export function fakeDialogShim(options: FakeDialogOptions = {}): FakeDialog {
	const base = fakeWindowShim();
	const calls: string[] = [];
	const paths = [...(options.paths ?? [])];
	const ready = options.ready ?? true;
	let status = 0;

	const symbols: LinuxShim = {
		...base.symbols,
		shim_dialog_ready: () => (ready ? 1 : 0),
		shim_dialog_missing: () => (ready ? "" : (options.missing ?? "gtk_file_chooser_native_new")),
		shim_dialog_open: (title, filters, multiple, directory, parent) => {
			calls.push(
				`open:${uncstring(title)}:${uncstring(filters)}:${multiple}:${directory}:${parent}`,
			);
			status = options.start === 1 || options.start === undefined ? 1 : 0;
			return options.start ?? 1;
		},
		shim_dialog_save: (title, suggested, filters, parent) => {
			calls.push(`save:${uncstring(title)}:${uncstring(suggested)}:${uncstring(filters)}:${parent}`);
			status = options.start === 1 || options.start === undefined ? 1 : 0;
			return options.start ?? 1;
		},
		shim_dialog_status: () => status,
		shim_dialog_count: () => paths.length,
		shim_dialog_path: (index) => paths[index] ?? "",
		shim_dialog_cancel: () => {
			calls.push("cancel");
			if (status !== 1) return 0;
			status = 3;
			return 1;
		},
		shim_dialog_release: () => {
			calls.push("release");
			status = 0;
		},
	};

	const fake: FakeDialog = {
		symbols,
		calls,
		paths,
		get status(): number {
			return status;
		},
		set status(next: number) {
			status = next;
		},
	};
	return fake;
}
