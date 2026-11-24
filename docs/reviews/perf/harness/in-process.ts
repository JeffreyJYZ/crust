/**
 * In-process scaffold for the baseline: a real crust bridge and window, no
 * focus theft, no OS screenshot. The private WebKit occlusion selector is
 * DEV-ONLY SCAFFOLDING — never a shipped default. Occluding a background window
 * is correct battery behaviour; this exists only so rAF runs headlessly.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { windowUrl } from "../../src/app-windows.ts";
import { startBridge } from "../../src/bridge/server.ts";
import { setTestingActivation } from "../../src/plugins/activation-policy.ts";
import { definePlugin, type PluginContext } from "../../src/plugins/define.ts";
import { createWindowPlugin } from "../../src/plugins/window.ts";
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import { DarwinPlatform } from "../../src/platform/darwin/platform.ts";
import { runConditions, snapshot } from "./conditions.ts";
import { perfNative } from "./perf-native.ts";

const RUN_MS = 14_000;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function runInProcess(label: string, root: string, out: string): Promise<number> {
	if (process.platform !== "darwin") {
		console.log("perf: FAIL in-process scaffold needs macOS/WebKit");
		return 1;
	}
	const start = await snapshot();
	setTestingActivation("none");
	const native = perfNative();
	let pings = 0;
	let events = 0;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let done = false;
	let platform: DarwinPlatform | undefined;
	let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
	let occlusionDisabled = false;
	let keepAwake = false;
	let occlusionState = -1;

	const cleanup = (): void => {
		try {
			platform?.destroy("main");
			platform?.stopPump();
		} catch {
			// Already torn down; exit handlers cannot report.
		}
	};
	const onExit = (): void => cleanup();
	process.on("exit", onExit);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			cleanup();
			process.kill(process.pid, signal);
		});
	}

	try {
		const perf = definePlugin({
			name: "perf",
			commands: {
				ping: () => ({ n: ++pings }),
				pace: async ({ ms }: { ms?: number }) => {
					await Bun.sleep(typeof ms === "number" ? Math.min(Math.max(ms, 1), 100) : 16);
					return { n: ++pings };
				},
				stream: ({ hz }: { hz?: number }, ctx: PluginContext) => {
					const rate = typeof hz === "number" && hz > 0 ? hz : 30;
					if (ticker !== undefined) clearInterval(ticker);
					ticker = setInterval(
						() => {
							events += 1;
							ctx.emit("perf:tick", { n: events });
						},
						Math.round(1000 / rate),
					);
					return { started: true, hz: rate };
				},
				stop: () => {
					if (ticker !== undefined) clearInterval(ticker);
					ticker = undefined;
					return { stopped: true, events };
				},
				report: async ({ json, final }: { json: string; final?: boolean }) => {
					if (ticker !== undefined) clearInterval(ticker);
					ticker = undefined;
					const memory = process.memoryUsage();
					const record = {
						...JSON.parse(json),
						backend: {
							pingCount: pings,
							eventCount: events,
							heapUsedBytes: memory.heapUsed,
							rssBytes: memory.rss,
						},
					};
					await writeFile(out, `${JSON.stringify(record, null, 2)}\n`, "utf8");
					if (final === true) done = true;
					return { written: true };
				},
				quit: () => {
					done = true;
					return { quitting: true };
				},
			},
		});
		const publicDir = resolve(root, "examples/perf-probe/public");
		platform = new DarwinPlatform({ appName: "crust-perf-baseline", activate: "never" });
		bridge = startBridge({
			handlers: [perf, createWindowPlugin(darwinWindowAdapter(platform))],
			root: publicDir,
		});
		await platform.start();
		platform.pump(16);
		const url = windowUrl({ label: "main", url: "/" }, undefined, bridge);
		platform.createWindow({
			label: "main",
			url,
			width: 900,
			height: 640,
			title: "Perf baseline probe",
			activate: false,
		});
		const web = platform.webview("main");
		const win = platform.nativeWindow("main");
		if (web === undefined || win === undefined) throw new Error("probe window has no webview");
		// Apply BEFORE the first page evaluate; WebKit caches occlusion at first visibility.
		(await import("../../src/platform/darwin/objc.ts")).S.vq1(win, "setCollectionBehavior:", 1);
		occlusionDisabled = native.perf_occlusion(web, 0) === 1;
		keepAwake = native.perf_keep_awake() === 1;
		occlusionState = Number(native.perf_occlusion_state(win));
		if (!occlusionDisabled) throw new Error("private occlusion selector absent: rAF suspended");
		console.log(
			`perf scaffold: occlusionDisabled=${occlusionDisabled} keepAwake=${keepAwake} ` +
				`occlusionState=${occlusionState} occluded=${(occlusionState & 2) === 0}`,
		);

		const deadline = performance.now() + RUN_MS;
		while (!done && performance.now() < deadline) await sleep(50);
		if (!done) throw new Error(`no report within ${RUN_MS} ms`);
	} finally {
		cleanup();
		process.removeListener("exit", onExit);
		await bridge?.stop();
	}

	const end = await snapshot();
	const sample = JSON.parse(await readFile(out, "utf8")) as Record<string, unknown>;
	const levels = sample.levels as Array<Record<string, unknown>>;
	const occlusion = {
		disabled: occlusionDisabled,
		keepAwake,
		state: occlusionState,
		occluded: occlusionState < 0 ? null : (occlusionState & 2) === 0,
	};
	for (const level of levels) {
		level.occlusion = occlusion;
	}
	Object.assign(sample, { label, conditions: runConditions(start, end), occlusion });
	const bad = levels.filter((level) => Number(level.fps) < 10 || Number(level.frames) === 0);
	if (bad.length > 0) {
		await rm(out, { force: true });
		console.log(
			`perf: FAIL sanity: ${bad.map((level) => `${level.name} fps=${level.fps}`).join(", ")}` +
				"; no sample written",
		);
		return 1;
	}
	await writeFile(out, `${JSON.stringify(sample, null, 2)}\n`, "utf8");
	return 0;
}
