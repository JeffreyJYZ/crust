/**
 * The backend half of the example: `main.ts` calls the extension's commands directly, the way it
 * calls any other function in the project, and prints what came back. The page half is
 * `public/app.js`, which reaches the same commands over the bridge as `clock.now`.
 *
 * Nothing here registers the extension — `crust dev` and `crust build` do that from
 * `extensions: ["extensions/clock.ts"]` in `crust.config.ts`, and this import resolves to the same
 * module instance, so the timer state is shared with whatever the page started.
 *
 * Run it with `bun run src/cli/index.ts dev --dir examples/extensions` from the repository root.
 */
import { app } from "crust";
import clock from "./extensions/clock.ts";

/** The backend is not a page, so `emit` prints the tick instead of pushing it to a window. */
const stdout = {
	emit: (event: string, data: unknown) => console.log(`  event ${event} ${JSON.stringify(data)}`),
};

function report(label: string, value: unknown): void {
	console.log(`  ${label.padEnd(16)} ${JSON.stringify(value)}`);
}

await app.run();

console.log("clock: driving the extension from main.ts");
report("clock.now", await clock.commands.now({}, stdout));
report("clock.startTimer", await clock.commands.startTimer({ everyMs: 300 }, stdout));

// Three ticks of a 300ms timer, then stop: the interval is the extension's, not this file's.
await Bun.sleep(950);
report("clock.stopTimer", await clock.commands.stopTimer({}, stdout));
