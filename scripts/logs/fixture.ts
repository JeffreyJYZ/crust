/**
 * The scratch project `e2e-logs` writes: one window with a grant for `fs` and the app's own
 * `report`, deliberately no grant for `os`, and a small `logging.maxBytes` so the live file
 * rotates inside one run.
 * The page drives every event the log is supposed to record: a granted invoke, a refused one,
 * console lines, an uncaught throw, and then it closes its own window so the app quits itself.
 */

/** `app.id`; the log directory hangs under this, and the harness clears it before the run. */
export const APP_ID = "land.jyz.e2e-logs";

/** `app.name`, and the `.app` name `crust build` produces. */
export const APP_NAME = "Logs crust";

/** `CFBundleExecutable`, pinned by `crust build` (the same constant as `e2e.ts`). */
export const BINARY_NAME = "crust-app";

/**
 * A value planted in a URL query so a naive log leaks it: the redaction pass is supposed to
 * scrub a `token=` query out of any message, which is why the page puts this in the message
 * it throws *and* in its own URL.
 */
export const PLANTED_SECRET = "PLANTED-SECRET-VALUE";

/**
 * Well under the events one run writes, so `app.1.jsonl` is the frame this threshold produces
 * rather than a five-megabyte file. The console loop and the invoke loop are sized against it.
 */
export const MAX_BYTES = 4096;

/** The single capability this window holds; `os` is absent on purpose, so its invoke is refused. */
export const GRANTED = ["fs:list", "window:close"];

export const CONFIG_SOURCE = `import type { CrustConfig } from "crust";

export default {
	app: { id: ${JSON.stringify(APP_ID)}, name: ${JSON.stringify(APP_NAME)}, version: "0.1.0" },
	windows: [{ label: "main", url: "/", width: 420, height: 280, title: ${JSON.stringify(APP_NAME)} }],
	security: {
		capabilities: [{ name: "granted", actions: ${JSON.stringify(GRANTED)} }],
		grants: { main: ["granted"] },
	},
	logging: { level: "debug", maxBytes: ${MAX_BYTES}, generations: 3 },
} satisfies CrustConfig;
`;

/**
 * The backend. Registering a `window-all-closed` listener is what makes crust quit by itself once
 * the page closes its window; the short wait lets the logger's queued writes land before the
 * process ends.
 */
export const MAIN_SOURCE = `import { app } from "crust";

app.on("window-all-closed", async () => {
	console.log("  app       every window closed");
	await Bun.sleep(400);
});

await app.run();
`;

/**
 * The page's whole script. The throw is in a timer because an uncaught error must reach the log
 * the way a real page's does, and the close is delayed so the error, the console lines and the
 * invokes all land before the window goes away.
 */
export const PAGE_SOURCE = `(async () => {
	const api = window.crust;
	await api.ready;

	await api.invoke("fs", "list", { path: "." });
	for (let i = 0; i < 12; i += 1) console.log("console line " + i + " " + "x".repeat(90));

	try {
		await api.invoke("os", "info", {});
	} catch (error) {
		console.log("os refused " + (error && error.code));
	}

	for (let i = 0; i < 18; i += 1) await api.invoke("fs", "list", { path: "." });

	history.replaceState(null, "", "/?token=${PLANTED_SECRET}");
	setTimeout(() => {
		throw new Error("the page threw while reading " + location.href);
	}, 50);
	setTimeout(() => {
		api.invoke("window", "close", { label: "main" }).catch(() => undefined);
	}, 1200);
})();
`;
