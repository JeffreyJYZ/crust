/**
 * The multi-window example's backend: a channel, not a driver.
 *
 * `crust:window` is a page-facing plugin, and the running `Platform` is private to
 * `startApp` — `app` exposes no accessor for it, so a backend cannot issue a window
 * command at all. The page therefore drives, and this file prints what the platform
 * answered, one line per step, then a verdict. That is the whole regression guard:
 * a run where an action landed on the first window prints a different frame or a
 * different label list, and the count of lines is exact in both directions.
 */
import { app } from "crust";

/** The steps the page reports. An exact count, so a half-run cannot look like a pass. */
const STEPS = 5;

let reported = 0;
let failures = 0;

app.command("report", (args: { line?: string }) => {
	const line = typeof args.line === "string" ? args.line : "";
	if (line.length === 0) return "ignored";
	if (line.startsWith("failed ")) failures += 1;
	reported += 1;
	console.log(line);
	if (reported === STEPS) {
		const verdict = failures === 0 ? "PASS" : "FAIL";
		console.log(`multi-window: ${verdict} ${reported - failures}/${STEPS}`);
	}
	return "printed";
});

/**
 * The page drives only after `run()` has resolved. `run()` creates the windows and
 * then starts the pump, so a page that drove on load could answer before the header
 * below; this flag makes the header the first line of every run.
 */
let up = false;

app.command("ready", () => up);

app.on("window-all-closed", () => {
	console.log("multi-window: every window closed; quitting");
});

await app.run();
console.log("multi-window: two windows from config, one page in both");
up = true;
