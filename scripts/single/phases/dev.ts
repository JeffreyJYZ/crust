/**
 * Phase 1: `crust dev app.tsx` — the generated runner opens a window, the bridge
 * serves the page from `.crust/single`, and the page's own `invoke("info")` is
 * answered.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Verdict } from "../../e2e-harness.ts";
import { spawnLive } from "../../lib/live-run.ts";
import { survivorsOfPids } from "../../lib/pids.ts";
import { lastLine } from "../../lib/text.ts";
import { APP_FILE, CLI, DEV_TIMEOUT_MS, INFO, type Paths } from "../fixture.ts";

export async function devPhase(verdict: Verdict, scratch: string, paths: Paths): Promise<void> {
	const dev = spawnLive([CLI, "dev", APP_FILE], scratch);
	try {
		const answer = await dev.wait("out", INFO, 1, DEV_TIMEOUT_MS);
		verdict.check(
			"dev info",
			answer !== null,
			answer ??
				`no info answer within ${DEV_TIMEOUT_MS / 1000} s — ` +
					(lastLine(dev.text("out")) ||
						lastLine(dev.text("err")) ||
						"crust dev printed nothing"),
		);

		const served = await stat(join(paths.devDir, "index.html"))
			.then((entry) => entry.isFile())
			.catch(() => false);
		const module = await stat(paths.devPage)
			.then((entry) => entry.isFile())
			.catch(() => false);
		verdict.check(
			"dev bundle",
			served && module,
			served && module
				? ".crust/single/{index.html,page.js} written by the dev build"
				: `the dev build never wrote .crust/single — index.html ${served ? "ok" : "missing"}, ` +
						`page.js ${module ? "ok" : "missing"}`,
		);

		// The runtime is a child of the CLI, so both have to be gone before the
		// assertion means anything; capture them while the parent still exists.
		const runtime = await dev.children();
		const code = await dev.stop();
		const started = dev.pid;
		verdict.check(
			"dev stop",
			code === 0,
			code === 0
				? `crust dev exited 0 on SIGTERM (pid ${started})`
				: `crust dev exited ${code ?? "null"} after the process group was signalled`,
		);

		// pid-based, not `pgrep -f <scratch>`: the CLI's argv holds the relative
		// `app.tsx`, so a path pattern would match nothing and pass for free.
		const left = await survivorsOfPids([started, ...runtime]);
		verdict.check(
			"dev clean",
			left.length === 0,
			left.length === 0
				? `no dev process or runtime child remains (${runtime.length} child checked)`
				: `still running: pid ${left.join(", ")}`,
		);
	} finally {
		await dev.stop().catch(() => undefined);
	}
}
