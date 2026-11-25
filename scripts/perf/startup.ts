/**
 * Launch-to-interactive decomposition. One process launch per invocation, same
 * bridge/platform path as the 634 ms number in 08-latency, with a mark at every
 * boundary so the total can be written as a stacked table.
 *
 * Run through `probe-run` so focus is handed back even if this process dies:
 *   probe-run -c 'bun scripts/perf/startup.ts measure --label startup-before-1'
 *   bun scripts/perf/startup.ts summary
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cac } from "cac";
import { windowUrl } from "../../src/app-windows.ts";
import { startBridge } from "../../src/bridge/server.ts";
import { setTestingActivation } from "../../src/plugins/activation-policy.ts";
import { definePlugin } from "../../src/plugins/define.ts";
import { createWindowPlugin } from "../../src/plugins/window.ts";
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import { DarwinPlatform } from "../../src/platform/darwin/platform.ts";
import { runConditions, snapshot } from "./conditions.ts";
import { PAGE, stack, summarize } from "./startup-format.ts";
import { perfNative } from "./perf-native.ts";

// Derived from uptime, so it is the real process start even though the static
// imports above were parsed and evaluated before this first statement ran.
const processStart =
	Date.now() - (typeof process.uptime === "function" ? process.uptime() * 1000 : 0);
const marks: Record<string, number> = { processStart: 0 };
const mark = (name: string): void => {
	marks[name] = Date.now() - processStart;
};
mark("firstLine");

const root = resolve(import.meta.dir, "../..");
const samples = resolve(root, "docs/reviews/perf/startup");
const DEADLINE_MS = 14_000;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function measure(label: string, blank = false): Promise<number> {
	if (process.platform !== "darwin") {
		console.log("startup: FAIL needs macOS/WebKit");
		return 1;
	}
	if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(label)) {
		console.log(`startup: FAIL bad label ${label}`);
		return 1;
	}
	const start = await snapshot();
	mark("conditionsDone");
	setTestingActivation("none");
	const native = perfNative();
	mark("nativeReady");

	let done = false;
	let anchors: Record<string, number> | undefined;
	let platform: DarwinPlatform | undefined;
	let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
	const publicDir = mkdtempSync(join(tmpdir(), "crust-startup-"));
	writeFileSync(join(publicDir, "index.html"), PAGE, "utf8");

	const cleanup = (): void => {
		try {
			platform?.destroy("main");
			platform?.stopPump();
		} catch {
			// Already torn down; exit handlers cannot report.
		}
	};
	process.on("exit", cleanup);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			cleanup();
			process.kill(process.pid, signal);
		});
	}

	try {
		const probe = definePlugin({
			name: "startup",
			commands: {
				report: async ({ json }: { json: string }) => {
					anchors = JSON.parse(json) as Record<string, number>;
					done = true;
					return { written: true };
				},
			},
		});
		platform = new DarwinPlatform({ appName: "crust-startup-probe", activate: "never" });
		await platform.start();
		mark("platformStarted");
		bridge = startBridge({
			handlers: [probe, createWindowPlugin(darwinWindowAdapter(platform))],
			root: publicDir,
			port: 0,
		});
		mark("bridgeReady");
		platform.pump(16);
		const url = blank
			? "about:blank"
			: windowUrl({ label: "main", url: "/" }, undefined, bridge);
		platform.createWindow({
			label: "main",
			url,
			width: 240,
			height: 160,
			title: "Startup decomposition probe",
			activate: false,
		});
		mark("windowCreated");
		const web = platform.webview("main");
		const win = platform.nativeWindow("main");
		if (web === undefined || win === undefined) throw new Error("probe window has no webview");
		if (native.perf_occlusion(web, 0) !== 1)
			throw new Error("private occlusion selector absent: rAF suspended");
		if (!blank) {
			const deadline = performance.now() + DEADLINE_MS;
			while (!done && performance.now() < deadline) await sleep(25);
			if (!done) throw new Error(`no report within ${DEADLINE_MS} ms`);
		}
	} finally {
		cleanup();
		process.removeListener("exit", cleanup);
		await bridge?.stop();
		await rm(publicDir, { recursive: true, force: true });
	}

	const end = await snapshot();
	// A blank control stops at window creation: rows 8-10 are zero by definition there.
	if (blank) {
		const created = marks.windowCreated ?? 0;
		marks.navAt = created;
		marks.readyAt = created;
		marks.firstRafAt = created;
	} else {
		Object.assign(marks, {
			navAt: (anchors?.navAt ?? processStart) - processStart,
			readyAt: (anchors?.readyAt ?? processStart) - processStart,
			firstRafAt: (anchors?.firstRafAt ?? processStart) - processStart,
		});
	}
	const rows = stack(marks);
	const bad = rows.filter(([, ms]) => !Number.isFinite(ms) || ms < 0);
	if (bad.length > 0) {
		console.log(`startup: FAIL segment ordering: ${bad.map(([n]) => n).join(", ")}`);
		return 1;
	}
	if (end.probePids.length > 0) {
		console.log(`startup: FAIL leaked probe PIDs: ${end.probePids.join(",")}`);
		return 1;
	}
	mkdirSync(samples, { recursive: true });
	const record = {
		label,
		mode: blank ? "blank" : "page",
		marks,
		segments: Object.fromEntries(rows),
		totalMs: marks.firstRafAt,
		conditions: runConditions(start, end),
	};
	await writeFile(join(samples, `${label}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
	const c = record.conditions;
	console.log(
		`startup ${label}: ${record.totalMs} ms, contaminated=${c.contaminated} ` +
			`load ${c.start.load.one.toFixed(2)} -> ${c.end.load.one.toFixed(2)}`,
	);
	return 0;
}

const cli = cac("startup");
cli.command("measure", "decompose one launch")
	.option("--label <name>", "sample label", { default: "startup" })
	.option("--blank", "control: load about:blank, stop at window creation");
cli.command("summary", "stacked table for the median run").option("--mode <name>", "page | blank", {
	default: "page",
});
const parsed = cli.parse(["bun", "startup", ...process.argv.slice(2)], { run: false });
mark("cliParsed");
if (process.argv[2] === "measure") {
	process.exitCode = await measure(
		String(parsed.options.label ?? "startup"),
		parsed.options.blank === true,
	);
} else if (process.argv[2] === "summary") {
	process.exitCode = await summarize(
		samples,
		() => readdir(samples),
		(path) => readFile(path, "utf8"),
		String(parsed.options.mode ?? "page"),
	);
} else {
	cli.outputHelp();
	process.exitCode = 1;
}
