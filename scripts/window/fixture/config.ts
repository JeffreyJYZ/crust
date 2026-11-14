/**
 * The project this proof writes into its scratch directory: the config, the
 * backend it runs, and the two strings that make a title apply or fail.
 */

/** `CFBundleExecutable` that `crust build` pins. Same constant as `e2e.ts`. */
export const BINARY_NAME = "crust-app";

/** `app.name` in the generated config; also the bundle's name. */
export const APP_NAME = "Window crust";

/**
 * The two configured windows. `other` serves the driver and `main` is the spare: `focus` on another label must reach a different `NSWindow`, and `create` is proved on `main` while the driver stays alive, since closing the driver kills the page mid-proof.
 * `main` loads `/spare/idle.html` so a path-relative `create` URL must resolve to `/spare/child/…`; at `/` the recorded base and this page's own would coincide and the resolution would be unobservable.
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
 * The backend. `report` is the page's channel — one line per window answer on stdout, which is the log the proof reads — and `seen` hands back the tags recorded so far so the driver can wait for a created window's page before closing it. `window-all-closed` must run after the page closes the second window.
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
