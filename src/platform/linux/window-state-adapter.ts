/**
 * The labelled half of the state commands on GTK: geometry, the three window-manager flags and
 * always-on-top. Three GTK3 facts are visible here.
 * Every `is*` reads GDK's own state word, never a value this adapter remembered, so a window
 * manager that ignored a request reports what actually happened instead of what was asked for.
 * `setPosition`/`getPosition` refuse off X11: Wayland gives a client no placement and no way to
 * learn where the compositor put a toplevel, so a reported origin there would be a fiction.
 * GTK has no getter for iconified or fullscreen, which is why the flag reads share `state`.
 */
import type { WindowPoint, WindowSize, WindowStateNative } from "@/plugins/window";
import { GDK_STATE, type Refusal, refuse, type WindowSends } from "./window-sends.ts";

/** The one reason a toplevel cannot be placed, shared by both position commands. */
const NO_PLACEMENT =
	"is not available on this display — GTK can only place a toplevel on X11, and Wayland gives a " +
	"client neither a move nor a way to read where the compositor put it";

export function windowStateAdapter(
	require: (label: string) => bigint,
	sends: WindowSends,
	gate: Refusal,
): WindowStateNative {
	/** One GDK state bit for a label, refused when GDK has no GdkWindow to report on yet. */
	const has = (label: string, member: string, bit: number): boolean =>
		(gate(member, () => sends.state(require(label))) & bit) !== 0;

	return {
		setSize: (label, size) => {
			gate("setSize", () => sends.resize(require(label), size));
		},
		getSize: (label): WindowSize => gate("getSize", () => sends.size(require(label))),
		setPosition(label, point) {
			if (!sends.placeable()) refuse("setPosition", NO_PLACEMENT);
			gate("setPosition", () => sends.move(require(label), point));
		},
		getPosition: (label): WindowPoint => {
			if (!sends.placeable()) refuse("getPosition", NO_PLACEMENT);
			return gate("getPosition", () => sends.position(require(label)));
		},
		setAlwaysOnTop: (label, value) => {
			gate("setAlwaysOnTop", () => sends.keepAbove(require(label), value));
		},
		isAlwaysOnTop: (label) => has(label, "isAlwaysOnTop", GDK_STATE.above),
		setFullscreen: (label, value) => {
			gate("setFullscreen", () => sends.setFlag(require(label), "fullscreen", value));
		},
		isFullscreen: (label) => has(label, "isFullscreen", GDK_STATE.fullscreen),
		minimize: (label) => {
			gate("minimize", () => sends.setFlag(require(label), "iconified", true));
		},
		unminimize: (label) => {
			gate("unminimize", () => sends.setFlag(require(label), "iconified", false));
		},
		isMinimized: (label) => has(label, "isMinimized", GDK_STATE.iconified),
		maximize: (label) => {
			gate("maximize", () => sends.setFlag(require(label), "maximized", true));
		},
		isMaximized: (label) => has(label, "isMaximized", GDK_STATE.maximized),
	};
}
