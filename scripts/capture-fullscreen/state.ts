/**
 * The read-only half of the fullscreen capture probe: System Events names the frontmost app and its
 * fullscreen windows, AppKit answers the probe window's Space, occlusion and visibility. Split out
 * of the probe so each file stays under the 200-line cap, and shared by every poll of a transition.
 */
import { S } from "@/platform/darwin/objc.ts";
import { captureFrontmost } from "../e2e-harness.ts";

export const APP = "crust-fullscreen-capture";

const FULLSCREEN = `tell application "System Events"
set found to {}
repeat with p in (every process whose background only is false)
try
repeat with w in (windows of p)
if (value of attribute "AXFullScreen" of w) is true then
set end of found to (name of p)
exit repeat
end if
end repeat
end try
end repeat
return found
end tell`;

/** Read-only AppleScript; an empty answer is reported, never guessed at. */
function ask(source: string): string {
	try {
		const result = Bun.spawnSync(["osascript", "-e", source], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : "";
	} catch {
		return "";
	}
}

export interface State {
	frontmost: string;
	fullscreen: string;
	onActiveSpace: boolean;
	occlusion: number;
	visible: boolean;
	condition: boolean;
	reason: string;
}

/** One full read of the transition, on every poll as well as at startup. */
export async function readState(win: number): Promise<State> {
	const frontmost = (await captureFrontmost()) ?? "unknown";
	const listed = ask(FULLSCREEN);
	const other = listed
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name && name.toLowerCase() !== APP.toLowerCase());
	const fullscreenFrontmost = other.some(
		(name) => name.toLowerCase() === frontmost.toLowerCase(),
	);
	const onActiveSpace = S.b0(win, "isOnActiveSpace");
	// A fullscreen app on another display keeps this window on the active Space, which is
	// visibly NOT the reported state. Both facts are required before the gate applies.
	const condition = fullscreenFrontmost && !onActiveSpace;
	const reason = !fullscreenFrontmost
		? `frontmost ${frontmost} has no fullscreen window`
		: onActiveSpace
			? `the probe window is on the active Space, so no fullscreen app owns it`
			: `frontmost ${frontmost} is fullscreen and the probe window is off its Space`;
	return {
		frontmost,
		fullscreen: other.length ? other.join(", ") : "none",
		onActiveSpace,
		occlusion: S.q0(win, "occlusionState"),
		visible: S.b0(win, "isVisible"),
		condition,
		reason,
	};
}

export function printState(state: State): void {
	console.log(`frontmost: ${state.frontmost}`);
	console.log(`fullscreen: ${state.fullscreen}`);
	console.log(
		`window: onActiveSpace=${state.onActiveSpace ? 1 : 0} ` +
			`occlusion=${state.occlusion} visible=${state.visible ? 1 : 0}`,
	);
	console.log(`condition: ${state.condition ? "YES" : "NO"} (${state.reason})`);
}
