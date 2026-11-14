/**
 * The project this proof writes into its scratch directory: the config, the
 * backend it runs, and the two strings that make a title apply or fail.
 */

/** `CFBundleExecutable` that `crust build` pins. Same constant as `e2e.ts`. */
export const BINARY_NAME = "crust-app";

/** `app.name` in the generated config; also the bundle's name. */
export const APP_NAME = "Window crust";

/**
 * The two configured windows, and which one drives the page.
 *
 * `other` serves the driver and `main` is a spare. Two windows is the point:
 * `focus` on a different label must reach a different `NSWindow`, not the same
 * one renamed. The driver must never sit in the window `create` is tested
 * against — closing it kills the page mid-proof — so the spare goes first in the
 * list, which is also the order `window-all-closed` checks: it calls
 * `platform.window(label)` per configured label and stops at the first open one,
 * so `main` is examined (and a closed `main` pruned) while the driver is alive.
 *
 * `main` loads `/spare/idle.html` rather than `/idle.html` on purpose, and it is
 * the only reason for that subdirectory: `create` with a relative URL resolves
 * against the document the platform recorded for an open window, and `main` is
 * the first of the two, so a path-relative request must land under `/spare/`.
 * At `/` the recorded base and this page's own `/` would coincide and the
 * resolution would be unobservable.
 */
export const CONFIG_SOURCE = `import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.e2e-window", name: ${JSON.stringify(APP_NAME)}, version: "0.1.0" },
	windows: [
		{ label: "main", url: "/spare/idle.html", width: 420, height: 280, title: "Spare" },
		{ label: "other", url: "/", width: 900, height: 640, title: ${JSON.stringify(APP_NAME)} },
	],
} satisfies CrustConfig;
`;

/**
 * The backend. `report` is the page's channel: one line per window answer, on
 * this process's stdout, which is the log the proof reads. `seen` hands the tags
 * recorded so far back to the page, so the driver can wait for a *created*
 * window's page to report before closing the window it is proving.
 * `window-all-closed` is what must run after the page closes the second window.
 */
export const MAIN_SOURCE = `import { app } from "crust";

const reported = [];

app.command("report", (args) => {
	const line = typeof args.line === "string" ? args.line : "";
	const tag = line.split(" ")[0];
	if (tag) reported.push(tag);
	console.log(\`  page      \${line}\`);
	return "printed";
});

app.command("seen", () => [...reported]);

app.on("window-all-closed", () => {
	console.log("  window    every window closed; quitting");
});

await app.run();
`;

/** A title AppKit can apply; the adapter reads it back and only then says ok. */
export const APPLIED_TITLE = "Renamed by the page";

/**
 * A title that cannot be applied: the shim builds the NSString with
 * `initWithBytes:length:strlen(bytes)`, so the NUL truncates it to "x" and the
 * adapter's own read-back disagrees with what was asked for. That turns a silent
 * partial title into an error, which is the behaviour under test.
 */
export const IMPOSSIBLE_TITLE = "x\u0000y";
