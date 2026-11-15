/**
 * Does a real key press reach a registered global hot key?
 *
 * The adapter's `dispatch` proves the process side. This posts an actual
 * Cmd+Shift+K to the HID tap — no cursor, no click — and waits for the plugin's
 * emit. It only means anything inside a running app, because a Carbon hot-key
 * handler is dispatched by the run loop; a bare script has none and hears
 * nothing, which is what the first attempt measured.
 */
import { dlopen, FFIType } from "bun:ffi";
// A probe may reach into the repo's own sources: it is a test artifact, and the
// public entry does not expose the darwin adapter a real hot key needs.
import { mark } from "./proofs.ts";
import { createShortcutsPlugin } from "../../src/plugins/shortcuts.ts";
import { darwinShortcutsAdapter } from "../../src/platform/darwin/shortcuts.ts";

const KEY_K = 40;
const FLAG_SHIFT = 1 << 17;
const FLAG_COMMAND = 1 << 20;

function coreGraphics() {
	return dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
		CGEventCreateKeyboardEvent: {
			args: [FFIType.ptr, FFIType.u16, FFIType.bool],
			returns: FFIType.ptr,
		},
		CGEventSetFlags: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
		CGEventPost: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
		CFRelease: { args: [FFIType.ptr], returns: FFIType.void },
	}).symbols;
}

function postChord(): void {
	const cg = coreGraphics();
	for (const down of [true, false]) {
		const event = cg.CGEventCreateKeyboardEvent(null, KEY_K, down);
		if (!event) continue;
		cg.CGEventSetFlags(event, FLAG_SHIFT | FLAG_COMMAND);
		cg.CGEventPost(0, event);
		cg.CFRelease(event);
	}
}

/**
 * Returns the proof line. The plugin is built here from the real darwin adapter:
 * the runtime's own instance is private to `startApp`, and registering the same
 * chord twice would be refused.
 */
export async function proveKeyPress(): Promise<boolean> {
	console.log("keypress-marker entered");
	const plugin = createShortcutsPlugin(darwinShortcutsAdapter());
	const heard: string[] = [];
	const ctx = { emit: (_event: string, data: unknown) => heard.push(JSON.stringify(data)) };
	const registered = await plugin.commands.register(
		{ accelerator: "CommandOrControl+Shift+K" },
		ctx,
	);
	if (!registered?.ok) {
		console.log("shortcut-press skipped: registration refused");
		return mark("shortcut-press", false);
	}

	postChord();
	const deadline = Date.now() + 2000;
	while (heard.length === 0 && Date.now() < deadline) await Bun.sleep(50);
	await plugin.commands.unregisterAll({}, ctx);

	if (heard.length === 0) {
		console.log("shortcut-press not delivered: no handler ran");
		return mark("shortcut-press", false);
	}
	console.log(`shortcut-press delivered: ${heard[0]}`);
	return mark("shortcut-press", true);
}
