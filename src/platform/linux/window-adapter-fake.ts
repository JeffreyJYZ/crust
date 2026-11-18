/**
 * The adapter's completeness half of the fake: every member the Linux adapter implements, required.
 * The state and chrome halves are optional on the contract — an adapter written before those
 * commands existed still satisfies `WindowNative` — so a test calling them would `!` each one and
 * prove the type instead of the adapter. `fakeAdapter` walks the list and fails on a dropped member
 * before any case runs, which is the check that the adapter answers the whole contract.
 */
import type { WindowNative } from "@/plugins/window";
import type { LinuxPlatform } from "./platform.ts";
import type { LinuxShim } from "./shim-ffi.ts";
import { linuxWindowAdapter } from "./window-adapter.ts";

export type LinuxWindowNative = WindowNative &
	Required<
		Pick<
			WindowNative,
			| "create"
			| "setSize"
			| "getSize"
			| "setPosition"
			| "getPosition"
			| "setAlwaysOnTop"
			| "isAlwaysOnTop"
			| "setFullscreen"
			| "isFullscreen"
			| "minimize"
			| "unminimize"
			| "isMinimized"
			| "maximize"
			| "isMaximized"
			| "setDecorations"
			| "isDecorated"
			| "setOpacity"
			| "opacity"
			| "setCursor"
			| "setCursorVisible"
		>
	>;

/** The members the adapter must carry; also the list the completeness check walks. */
const IMPLEMENTED = [
	"create",
	"setSize",
	"getSize",
	"setPosition",
	"getPosition",
	"setAlwaysOnTop",
	"isAlwaysOnTop",
	"setFullscreen",
	"isFullscreen",
	"minimize",
	"unminimize",
	"isMinimized",
	"maximize",
	"isMaximized",
	"setDecorations",
	"isDecorated",
	"setOpacity",
	"opacity",
	"setCursor",
	"setCursorVisible",
] as const satisfies readonly (keyof LinuxWindowNative)[];

/** The adapter over a fake, proved complete before it is returned. */
export function fakeAdapter(platform: LinuxPlatform, symbols: LinuxShim): LinuxWindowNative {
	const native = linuxWindowAdapter(platform, symbols);
	for (const member of IMPLEMENTED) {
		if (native[member] === undefined) throw new Error(`linuxWindowAdapter has no ${member}`);
	}
	return native as LinuxWindowNative;
}
