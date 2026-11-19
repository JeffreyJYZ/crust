/**
 * The live window read, written into the scratch app's `main.ts`.
 *
 * The page can only ask a plugin, and no plugin exposes `collectionBehavior` or the style mask, so
 * the read happens here: this process owns the `NSWindow` AppKit drew. The sends go through the
 * framework's own `S` helpers rather than a hand-declared `objc_msgSend`: bun:ffi has no variadic
 * type, and a hand-declared one was measured answering `NSIntegerMax` for `-[NSArray count]` and a
 * shifted `windowNumber` — the C shim's fixed prototypes are what crust itself sends through. That
 * module is imported from this checkout by absolute path, so moving it moves this line with it.
 */

/** A module body: imported by `main.ts` in the scratch project, never by this repo's scripts. */
export function nativeProbe(repoRoot: string): string {
	const objc = JSON.stringify(`${repoRoot}/src/platform/darwin/objc.ts`);
	return `import { cls, S } from ${objc};

// The window this page is in. AppKit lists its own helpers in the same array — a launched crust app
// answers NSStatusBarWindow first (measured), and a fullscreen transition adds its toolbar overlay —
// so the window is picked by class pointer: the one plain NSWindow this app created. The comparison
// is numeric on purpose: a class name is a short ASCII NSString, which is a tagged pointer and
// cannot cross bun:ffi (measured: "refused to send UTF8String: guard failed").
function readWindow(expected) {
	const application = S.p0(cls("NSApplication"), "sharedApplication", true);
	const list = S.p0(application, "windows");
	const count = S.q0(list, "count");
	const wanted = cls("NSWindow");
	const ours = [];
	for (let index = 0; index < count; index++) {
		const window = S.p1(list, "objectAtIndex:", index);
		if (window && S.p0(window, "class") === wanted) ours.push(window);
	}
	const chosen = ours.length === 1 ? ours[0] : 0;
	const mask = chosen ? S.q0(chosen, "styleMask") : 0;
	const number = chosen ? S.q0(chosen, "windowNumber") : -1;
	return {
		windows: ours.length,
		active: S.b0(application, "isActive") ? 1 : 0,
		found: chosen !== 0 && (expected <= 0 || number === expected),
		collectionBehavior: chosen ? S.q0(chosen, "collectionBehavior") : -1,
		styleMask: mask,
		fullscreen: (mask & 16384) !== 0,
		onActiveSpace: chosen ? (S.b0(chosen, "isOnActiveSpace") ? 1 : 0) : -1,
		windowNumber: number,
	};
}
`;
}
