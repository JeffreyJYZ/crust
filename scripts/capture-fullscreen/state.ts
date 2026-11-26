/**
 * The read-only half of the fullscreen capture probe: System Events names the frontmost app and its
 * fullscreen windows for context; AppKit answers the probe window's Space, composited bit and
 * visibility. Split out of the probe so each file stays under the 200-line cap, and shared by every
 * poll of a transition.
 *
 * The predicate is the platform fact, not the Space: a view that has never composited is the state
 * that stalls a snapshot, and that window can sit on the active Space the whole time. Space
 * membership stays in the output as context only.
 */
import { S } from "@/platform/darwin/objc.ts";
import { captureFrontmost } from "../e2e-harness.ts";

export const APP = "crust-fullscreen-capture";

/** NSWindowOcclusionState's composited flag; 8192 means it is absent, 8194 means it is set. */
export const COMPOSITED_BIT = 2;

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
	/** True when the view has never composited — the measured condition, whatever the Space. */
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
	const onActiveSpace = S.b0(win, "isOnActiveSpace");
	const occlusion = S.q0(win, "occlusionState");
	const visible = S.b0(win, "isVisible");
	const composited = (occlusion & COMPOSITED_BIT) !== 0;
	const condition = !composited;
	const reason = composited
		? `the probe window composited (occlusionState=${occlusion}, bit 2 set)`
		: `the probe window has never composited (occlusionState=${occlusion}, bit 2 clear)`;
	return {
		frontmost,
		fullscreen: other.length ? other.join(", ") : "none",
		onActiveSpace,
		occlusion,
		visible,
		condition,
		reason,
	};
}

export function printState(state: State): void {
	console.log(`frontmost: ${state.frontmost}`);
	console.log(`fullscreen: ${state.fullscreen}`);
	console.log(
		`window: onActiveSpace=${state.onActiveSpace ? 1 : 0} ` +
			`occlusionState=${state.occlusion} visible=${state.visible ? 1 : 0}`,
	);
	console.log(`condition: ${state.condition ? "YES" : "NO"} (${state.reason})`);
}
