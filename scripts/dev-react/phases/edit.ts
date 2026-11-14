/**
 * Phase 5: a page edit belongs to the dev server, not the backend. The dev
 * server must serve the new text, the window must run it and answer again, and
 * the runtime must not print a second bridge line while that happens.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Verdict } from "../../e2e-harness.ts";
import type { LiveRun } from "../../lib/live-run.ts";
import { count, delay, lastLine, skip } from "../../lib/text.ts";
import {
	ARGUMENT,
	BRIDGE,
	DEV_ORIGIN,
	MARKER,
	RESTARTED,
	RESTART_SETTLE_MS,
	STEP_TIMEOUT_MS,
	poll,
} from "../fixture.ts";

export async function editPhase(
	verdict: Verdict,
	dev: LiveRun,
	scratch: string,
	greeted: boolean,
): Promise<void> {
	const pageFile = join(scratch, "src", "main.tsx");
	const before = await readFile(pageFile, "utf8");
	const occurrences = before.split(ARGUMENT).length - 1;
	const edited = before.replaceAll(ARGUMENT, `{ name: "${MARKER}" }`);
	await writeFile(pageFile, edited, "utf8");

	// The dev server transforms on demand, so this is the module the window
	// re-requests — not the file on disk.
	const module = await poll(
		`${DEV_ORIGIN}/src/main.tsx`,
		(body) => body.includes(`"${MARKER}"`),
		STEP_TIMEOUT_MS,
	);
	const served = occurrences === 1 && module !== null;
	verdict.check(
		"edit served",
		served,
		occurrences !== 1
			? `src/main.tsx has ${occurrences} copies of ${ARGUMENT} — the edit was not the one this proof expects`
			: module !== null
				? `${DEV_ORIGIN}/src/main.tsx serves ${MARKER} after the save`
				: `${DEV_ORIGIN}/src/main.tsx never served ${MARKER} within ${STEP_TIMEOUT_MS / 1000} s` +
					(dev.alive()
						? ""
						: ` — crust dev had already exited: ${lastLine(dev.text("out")) || "no output"}`),
	);

	if (!greeted) {
		skip(
			verdict,
			["edit reload"],
			"not checked — the window never answered, so nothing reloads",
		);
	} else {
		// The window re-ran the module it was served: the new argument reached
		// the backend through the same cross-origin invoke.
		const reran = await dev.wait(
			"out",
			new RegExp(`greet\\s+hello ${MARKER} `),
			1,
			STEP_TIMEOUT_MS,
		);
		verdict.check(
			"edit reload",
			reran !== null,
			reran ??
				`no greet answer for ${MARKER} within ${STEP_TIMEOUT_MS / 1000} s — ` +
					(lastLine(dev.text("out")) || "nothing new on stdout"),
		);
	}

	// One runtime start is one bridge line; a second means the watcher restarted the
	// backend for a page edit, which rotates the loaded page's token. Judged after a
	// bounded settle: the watcher debounces 150 ms and a restarted runtime needs a
	// moment to print, so reading at reload time reported "no restart" for a restart
	// still in flight — a false pass this script had until the settle went in.
	const settleUntil = performance.now() + RESTART_SETTLE_MS;
	while (performance.now() < settleUntil && !RESTARTED.test(dev.text("out"))) await delay(50);
	const restarted = RESTARTED.test(dev.text("out"));
	// A restarted runtime prints its own bridge line a moment later; wait for it,
	// bounded, so the count in the failure detail describes the whole sequence
	// instead of a restart caught halfway.
	if (restarted) {
		const bridgesUntil = performance.now() + RESTART_SETTLE_MS;
		while (performance.now() < bridgesUntil && count(dev.text("out"), BRIDGE) < 2) {
			await delay(50);
		}
	}
	const bridges = count(dev.text("out"), BRIDGE);
	const quiet = bridges === 1 && !restarted;
	// Gated on `served`: an edit that never reached the dev server would make a
	// single bridge line true by accident.
	if (!served) {
		skip(verdict, ["no restart"], "not checked — the edit never reached the dev server");
	} else {
		verdict.check(
			"no restart",
			quiet,
			quiet
				? "one bridge line across the edit — the backend was never restarted"
				: restarted
					? `the backend restarted for a page edit ("restart backend changed", ` +
						`${bridges} bridge line${bridges === 1 ? "" : "s"}) — the loaded page ` +
						"lost its token and the window was built again"
					: `${bridges} bridge lines across the edit — the runtime started more than once`,
		);
	}
}
