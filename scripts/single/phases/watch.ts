/**
 * Phase 3: a save rebuilds the page without restarting the runtime, and a
 * syntax error leaves the last good bundle exactly where it was.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { Verdict } from "../../e2e-harness.ts";
import { spawnLive } from "../../lib/live-run.ts";
import { survivorsOfPids } from "../../lib/pids.ts";
import { count, lastLine, skip } from "../../lib/text.ts";
import {
	APP_FILE,
	BRIDGE,
	BUILD_FAILED,
	brokenSource,
	CLI,
	DEV_TIMEOUT_MS,
	digest,
	INFO,
	pageSource,
	type Paths,
	REBUILT,
	RESTARTED,
	STEP_TIMEOUT_MS,
} from "../fixture.ts";

export async function watchPhase(verdict: Verdict, scratch: string, paths: Paths): Promise<void> {
	await writeFile(paths.appFile, pageSource("one"), "utf8");
	const watch = spawnLive([CLI, "dev", APP_FILE], scratch);
	try {
		const first = await watch.wait("out", INFO, 1, DEV_TIMEOUT_MS);
		if (first === null) {
			skip(
				verdict,
				[
					"save marker",
					"save answer",
					"no restart",
					"error reports",
					"error keeps",
					"error alive",
					"reload stop",
					"reload clean",
				],
				`not checked — the second crust dev never answered: ${lastLine(watch.text("out")) || "no output"}`,
			);
			return;
		}

		const markerBefore = (await readFile(paths.reloadMarker, "utf8").catch(() => "")).trim();
		const pageBefore = await digest(paths.devPage);

		// A real code change, not a comment: comments are dropped by the transpiler,
		// so they would leave the served bytes identical and prove nothing.
		await writeFile(paths.appFile, pageSource("two"), "utf8");
		const rebuilt = await watch.wait("out", REBUILT, 1, STEP_TIMEOUT_MS);
		const second = await watch.wait("out", INFO, 2, STEP_TIMEOUT_MS);

		const markerAfter = (await readFile(paths.reloadMarker, "utf8").catch(() => "")).trim();
		const pageAfter = await digest(paths.devPage);
		const markerMoved = markerBefore.length > 0 && markerAfter !== markerBefore;
		const pageMoved = pageBefore !== pageAfter;

		verdict.check(
			"save marker",
			markerMoved && pageMoved,
			markerMoved && pageMoved
				? `the served page moved ${pageBefore} -> ${pageAfter}, ` +
						`__crust_reload.txt ${markerBefore} -> ${markerAfter}`
				: !markerMoved
					? `__crust_reload.txt did not move from ${markerBefore || "missing"} after a save`
					: `the served page never changed (page.js still ${pageBefore})`,
		);

		verdict.check(
			"save answer",
			rebuilt !== null && second !== null,
			rebuilt !== null && second !== null
				? "the rebuilt page ran again in the same window and answered its invoke"
				: rebuilt === null
					? `no rebuild line within ${STEP_TIMEOUT_MS / 1000} s — ${lastLine(watch.text("out"))}`
					: "the window never reloaded: no second info answer after the save",
		);

		// A restart would start a second runtime and print a second bridge address;
		// the single-file watcher only rebuilds the page, so one bridge line is the
		// whole proof that the process survived the save.
		const bridges = count(watch.text("out"), BRIDGE);
		const restarted = RESTARTED.test(watch.text("out"));
		verdict.check(
			"no restart",
			bridges === 1 && !restarted,
			bridges === 1 && !restarted
				? "one bridge line across the save — the runtime was never restarted"
				: restarted
					? "the runtime restarted for a page edit"
					: `${bridges} bridge lines — the runtime started more than once`,
		);

		// A half-typed file is the failure a user meets by accident. It must be
		// reported and must not touch the bundle already on disk.
		await writeFile(paths.appFile, brokenSource(), "utf8");
		const failed = await watch.wait("err", BUILD_FAILED, 1, STEP_TIMEOUT_MS);
		const pageAfterError = await digest(paths.devPage);
		const markerAfterError = (
			await readFile(paths.reloadMarker, "utf8").catch(() => "")
		).trim();

		verdict.check(
			"error reports",
			failed !== null,
			failed ??
				`no build-failure line within ${STEP_TIMEOUT_MS / 1000} s — ` +
					(lastLine(watch.text("err")) || "nothing on stderr"),
		);
		verdict.check(
			"error keeps",
			pageAfterError === pageAfter && markerAfterError === markerAfter,
			pageAfterError === pageAfter && markerAfterError === markerAfter
				? `page.js (${pageAfterError}) and the marker are the last good build`
				: `a failed build changed the page: page.js ${pageAfter} -> ${pageAfterError}, ` +
						`marker ${markerAfter} -> ${markerAfterError}`,
		);
		verdict.check(
			"error alive",
			watch.alive(),
			watch.alive()
				? "the window's runtime is still running after the bad save"
				: "the runtime died on a syntax error in the page",
		);

		const runtime = await watch.children();
		const code = await watch.stop();
		verdict.check(
			"reload stop",
			code === 0,
			code === 0
				? "crust dev exited 0 on SIGTERM after two rebuilds"
				: `crust dev exited ${code ?? "null"} instead of stopping cleanly`,
		);

		const left = await survivorsOfPids([watch.pid, ...runtime]);
		verdict.check(
			"reload clean",
			left.length === 0,
			left.length === 0
				? `no dev process or runtime child remains (${runtime.length} child checked)`
				: `still running: pid ${left.join(", ")}`,
		);
	} finally {
		await watch.stop().catch(() => undefined);
	}
}
