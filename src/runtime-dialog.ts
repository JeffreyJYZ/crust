/**
 * Which `dialog` instance a non-darwin run registers: an adapted one on Windows and Linux, and the
 * bare refusal everywhere else — FreeBSD, and a darwin run that attached no platform.
 *
 * `dialog` is one of the two core namespaces with a native half, so the registry's own file carries
 * the choice rather than a second copy of the plugin. The adapters are injectable for the same reason
 * `nonDarwinScreenPlugin`'s are: the selection is what is proved on a machine with neither Win32 nor
 * GTK, and no test here reaches comdlg32 or a display server.
 */
import { createDialogPlugin, dialogPlugin } from "@/plugins";
import type { DialogNative } from "@/plugins/dialog";

/** One adapter per OS, injectable so the choice is testable without a native library. */
export interface DialogAdapters {
	windows?: DialogNative;
	linux?: DialogNative;
}

export async function nonDarwinDialogPlugin(
	os: string = process.platform,
	adapters: DialogAdapters = {},
): Promise<ReturnType<typeof createDialogPlugin>> {
	if (os === "win32") {
		const native =
			adapters.windows ??
			(await import("@/platform/windows/dialog")).windowsDialogAdapter();
		return createDialogPlugin(native);
	}
	if (os === "linux") {
		// The platform is read at registration so the panel is transient for the app's own window;
		// a run that built none yet gets an unparented panel rather than a guessed window pointer.
		const wiring = (await import("@/platform/linux/active-platform")).activeLinuxPlatform();
		const native =
			adapters.linux ??
			(await import("@/platform/linux/dialog")).linuxDialogAdapter(
				wiring?.platform,
				wiring?.native,
			);
		return createDialogPlugin(native);
	}
	// No native half: the bare plugin answers `not-implemented` naming the panel it needs, which is
	// an honest answer rather than a namespace that is missing from the registry.
	return dialogPlugin;
}
