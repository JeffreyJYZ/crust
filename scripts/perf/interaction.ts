/**
 * Interaction-latency harness. Reuses scripts/perf's condition snapshots, the
 * native occlusion override and the in-process window scaffold; it adds only
 * the page clock and window.capture paint proofs this lane needs.
 *
 * Run through `probe-run` so focus is handed back even if this process dies:
 *   probe-run -c 'bun scripts/perf/interaction-cli.ts measure --label lat-core --mode core'
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { windowUrl } from "../../src/app-windows.ts";
import { startBridge } from "../../src/bridge/server.ts";
import { setTestingActivation } from "../../src/plugins/activation-policy.ts";
import { definePlugin } from "../../src/plugins/define.ts";
import { createWindowPlugin } from "../../src/plugins/window.ts";
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import { DarwinPlatform } from "../../src/platform/darwin/platform.ts";
import { runConditions, snapshot } from "./conditions.ts";
import { perfNative } from "./perf-native.ts";
import { decorate, verify, type InteractionRecord, type Occlusion } from "./interaction-verify.ts";

/** The start of this process is the launch-to-interactive zero for --mode launch. */
const processStartMs = Date.now();
const root = resolve(import.meta.dir, "../..");
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const DEADLINE: Record<string, number> = {
	core: 25_000,
	paint: 12_000,
	windows: 14_000,
	launch: 8_000,
};

export async function runInteraction(label: string, mode: string, out: string): Promise<number> {
	if (process.platform !== "darwin") {
		console.log("interaction: FAIL needs macOS/WebKit");
		return 1;
	}
	const timeout = DEADLINE[mode] ?? 14_000;
	const start = await snapshot();
	setTestingActivation("none");
	const native = perfNative();

	let done = false;
	let platform: DarwinPlatform | undefined;
	let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
	let occlusion: Occlusion = { disabled: false, keepAwake: false, state: -1, occluded: null };

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
		const latency = definePlugin({
			name: "latency",
			commands: {
				report: async ({ json, final }: { json: string; final?: boolean }) => {
					await writeFile(out, `${JSON.stringify(JSON.parse(json), null, 2)}\n`, "utf8");
					if (final === true) done = true;
					return { written: true };
				},
				quit: () => {
					done = true;
					return { quitting: true };
				},
			},
		});
		const publicDir = resolve(root, "examples/perf-interaction/public");
		platform = new DarwinPlatform({ appName: "crust-perf-interaction", activate: "never" });
		const base = darwinWindowAdapter(platform);
		const objc = (await import("../../src/platform/darwin/objc.ts")).S;
		// Every window the page creates gets the same dev-only occlusion override,
		// applied at creation before its page can draw a frame.
		const adapter = {
			...base,
			create: (options: Parameters<NonNullable<typeof base.create>>[0]) => {
				if (typeof base.create !== "function") throw new Error("no native create");
				const result = base.create(options);
				const web = platform?.webview(options.label);
				const win = platform?.nativeWindow(options.label);
				if (web !== undefined && win !== undefined) {
					objc.vq1(win as number, "setCollectionBehavior:", 1);
					native.perf_occlusion(web as number, 0);
				}
				return result;
			},
		};
		bridge = startBridge({ handlers: [latency, createWindowPlugin(adapter)], root: publicDir });
		await platform.start();
		platform.pump(16);
		const url = windowUrl({ label: "main", url: `/?mode=${mode}` }, undefined, bridge);
		platform.createWindow({
			label: "main",
			url,
			width: 240,
			height: 160,
			title: "Interaction latency probe",
			activate: false,
		});
		const web = platform.webview("main");
		const win = platform.nativeWindow("main");
		if (web === undefined || win === undefined) throw new Error("probe window has no webview");
		objc.vq1(win as number, "setCollectionBehavior:", 1);
		const disabled = native.perf_occlusion(web as number, 0) === 1;
		const keepAwake = native.perf_keep_awake() === 1;
		const state = Number(native.perf_occlusion_state(win as number));
		if (!disabled) throw new Error("private occlusion selector absent: rAF suspended");
		occlusion = {
			disabled,
			keepAwake,
			state,
			occluded: state < 0 ? null : (state & 2) === 0,
		};
		console.log(
			`interaction scaffold: occlusionDisabled=${disabled} keepAwake=${keepAwake} ` +
				`state=${state} occluded=${occlusion.occluded}`,
		);

		const deadline = performance.now() + timeout;
		while (!done && performance.now() < deadline) await sleep(50);
		if (!done) throw new Error(`no report within ${timeout} ms in mode ${mode}`);
	} finally {
		cleanup();
		process.removeListener("exit", cleanup);
		await bridge?.stop();
	}

	const end = await snapshot();
	const record = JSON.parse(await readFile(out, "utf8")) as InteractionRecord;
	if (mode === "launch") {
		const anchors = record.launchAnchors;
		record.launch = {
			readyMs: anchors?.readyAt == null ? null : anchors.readyAt - processStartMs,
			firstFrameMs: anchors?.firstRafAt == null ? null : anchors.firstRafAt - processStartMs,
		};
	}
	record.processStartMs = processStartMs;
	decorate(record, label, mode, start, end, runConditions, occlusion);
	const bad = verify(record, mode);
	if (bad.length > 0) {
		await rm(out, { force: true });
		console.log(`interaction: FAIL sanity: ${bad.join(", ")}; no sample written`);
		return 1;
	}
	await writeFile(out, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	const c = record.conditions;
	console.log(
		`interaction ${label}/${mode}: contaminated=${c?.contaminated} ` +
			`load ${c?.start.load.one.toFixed(2)} -> ${c?.end.load.one.toFixed(2)}`,
	);
	return 0;
}

if (import.meta.main) {
	const { runCli } = await import("./interaction-cli.ts");
	await runCli();
}
