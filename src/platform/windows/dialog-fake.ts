/**
 * The six panel symbols a test drives, recording what the adapter handed C instead of reaching
 * comdlg32. Split from the test file because both the adapter's own tests and the registry's use it,
 * and because the arguments are the whole point: a `cstring` buffer is unreadable in an assertion,
 * so the fake records the UTF-8 it carried.
 */
import type { WindowsDialogShim } from "./dialog.ts";

export interface FakeDialogOptions {
	/** The status the next pick answers with; defaults to 1, a pick. */
	status?: number;
	/** The paths the next pick answered with. */
	paths?: string[];
	/** What `shim_dialog_missing` names, for the -2 arm. */
	missing?: string;
	/** What `shim_dialog_error` reports, for the -3 arm. */
	error?: number;
}

export interface FakeDialog {
	shim: WindowsDialogShim;
	/** Every call, as `name:arguments…`, in the order the adapter made it. */
	calls: string[];
	/** The answer the next pick gives; writable so one fake can drive two picks. */
	status: number;
	paths: string[];
}

/** The UTF-8 a `cstring` argument carried, minus its terminator. */
function text(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8").replace(/\0$/, "");
}

export function fakeDialogShim(options: FakeDialogOptions = {}): FakeDialog {
	const calls: string[] = [];
	const paths = [...(options.paths ?? [])];
	let status = options.status ?? 1;

	const fake: FakeDialog = {
		calls,
		paths,
		get status(): number {
			return status;
		},
		set status(next: number) {
			status = next;
		},
		shim: {
			shim_dialog_open: (title, filters, multiple, directory, owner) => {
				calls.push(`open:${text(title)}:${text(filters)}:${multiple}:${directory}:${owner}`);
				return status;
			},
			shim_dialog_save: (title, suggested, filters, owner) => {
				calls.push(`save:${text(title)}:${text(suggested)}:${text(filters)}:${owner}`);
				return status;
			},
			shim_dialog_count: () => paths.length,
			shim_dialog_path: (index) => paths[index] ?? "",
			shim_dialog_error: () => options.error ?? 0,
			shim_dialog_missing: () => options.missing ?? "",
		},
	};
	return fake;
}
