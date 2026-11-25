#!/usr/bin/env bun
/**
 * The two numbers this lane is judged on, taken in one real WebKit window with no focus theft:
 * the overlay's fps against the probe's independent counter, and frame-time p95 with the panel
 * hidden and shown. Occlusion detection is disabled in this dev-only scaffold, before the first
 * page evaluate; a shipped app keeps it on. No OS screenshot — `window.capture` renders the page.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { windowUrl } from "../../src/app-windows.ts";
import { startBridge } from "../../src/bridge/server.ts";
import { setTestingActivation } from "../../src/plugins/activation-policy.ts";
import { createPerfPlugin } from "../../src/plugins/perf.ts";
import { createWindowPlugin } from "../../src/plugins/window.ts";
import { darwinTestingAdapter } from "../../src/plugins/testing-darwin.ts";
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import { DarwinPlatform } from "../../src/platform/darwin/platform.ts";
import { perfNative } from "../../scripts/perf/perf-native.ts";
import { buildOverlay } from "./build.ts";
import { captureOverlay } from "./capture.ts";

const RUN_MS = 2500;
const REPO = resolve(import.meta.dir, "../..");
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function evaluate(adapter: { evaluate: (label: string, source: string) => Promise<unknown> }, expression: string): Promise<any> {
	const raw = await adapter.evaluate("main", expression);
	if (typeof raw !== "string") return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log("overlay-probe: FAIL needs macOS/WebKit");
		return 1;
	}
	setTestingActivation("none");
	const scratch = await mkdtemp(join(tmpdir(), "crust-overlay-probe-"));
	const publicDir = resolve(import.meta.dir, "public");
	await cp(publicDir, scratch, { recursive: true });
	const overlayJs = await buildOverlay();
	await writeFile(resolve(scratch, "overlay.js"), overlayJs, "utf8");
	const html = await readFile(resolve(scratch, "index.html"), "utf8");
	await writeFile(
		resolve(scratch, "index.html"),
		html.replace("</body>", '<script type="module" src="/overlay.js"></script></body>'),
		"utf8",
	);

	let platform: DarwinPlatform | undefined;
	let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
	const cleanup = (): void => {
		try {
			platform?.destroy("main");
			platform?.stopPump();
		} catch {
			// Already gone; an exit trap cannot report.
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
		const native = perfNative();
		platform = new DarwinPlatform({ appName: "crust-overlay-probe", activate: "never" });
		bridge = startBridge({
			handlers: [createPerfPlugin(), createWindowPlugin(darwinWindowAdapter(platform))],
			root: scratch,
		});
		await platform.start();
		platform.pump(16);
		const probeUrl = windowUrl({ label: "main", url: "/" }, undefined, bridge);
		platform.createWindow({
			label: "main",
			url: probeUrl,
			width: 900,
			height: 640,
			title: "Overlay probe",
			activate: false,
		});
		const web = platform.webview("main");
		const win = platform.nativeWindow("main");
		if (web === undefined || win === undefined) throw new Error("no webview for overlay probe");
		const { S } = await import("../../src/platform/darwin/objc.ts");
		S.vq1(win, "setCollectionBehavior:", 1);
		const occlusionOff = native.perf_occlusion(web, 0) === 1;
		const awake = native.perf_keep_awake() === 1;
		if (!occlusionOff) throw new Error("occlusion selector absent: rAF suspended");
		console.log(`conditions occlusionDisabled=${occlusionOff} keepAwake=${awake} activation=none`);

		const adapter = darwinTestingAdapter((label) => (label === undefined || label === "main" ? web : null));
		const deadline = performance.now() + 8000;
		let pageReady = false;
		while (performance.now() < deadline) {
			try {
				const state = await evaluate(adapter, "location.href + '/' + document.readyState + '/' + document.documentElement.outerHTML.length + '/' + typeof window.__probe + '/' + typeof window.crust");
				if (typeof state === "string" && state.endsWith("/object/object")) {
					pageReady = true;
					break;
				}
				console.log(`page wait state=${String(state)}`);
			} catch (error) {
				console.log(`page wait eval failed=${error instanceof Error ? error.message : String(error)}`);
			}
			await sleep(300);
		}
		if (!pageReady) throw new Error("probe page never loaded (no __probe or crust)");
		console.log("step mounted");
		const mounted = await evaluate(adapter, "JSON.stringify({overlay:typeof window.__overlay,api:typeof window.crust.perf.overlay})");
		console.log(`step mounted answered ${JSON.stringify(mounted)}`);
		const shape = mounted as { overlay?: string; api?: string } | string;
		if (typeof shape === "string" || shape.overlay !== "object" || shape.api !== "function") {
			throw new Error(`overlay page module not mounted: ${JSON.stringify(mounted)}`);
		}

		console.log("step layout");
		const before = await evaluate(adapter, "JSON.stringify(window.__probe.layout())");
		console.log(`step layout answered ${JSON.stringify(before)}`);
		const rows: Array<{ arm: string; overlayFps: number; probeFps: number; p95: number; frames: number }> = [];
		let text = "";
		for (const arm of ["hidden", "shown", "hidden", "shown"] as const) {
			// A transient app switch re-suspends rAF; re-assert both harness conditions per arm.
			S.vq1(win, "setCollectionBehavior:", 1);
			native.perf_occlusion(web, 0);
			await evaluate(adapter, `(window.__overlay.${arm === "shown" ? "show" : "hide"}(), 'ok')`);
			await evaluate(adapter, `(window.__probe.start(), 'ok')`);
			const t0 = performance.now();
			await sleep(RUN_MS);
			const at = await evaluate(adapter, "JSON.stringify({overlay:window.__overlay.readout().fps,probe:window.__probe.fps(),text:window.__overlay.panel.text(),layout:window.__probe.layout(),visible:window.__overlay.visible,visibility:document.visibilityState,hidden:document.hidden,clock:performance.now()})");
			const row = at as { overlay: number; probe: number; text: string; layout: unknown; visible: boolean; visibility: string; hidden: boolean; clock: number };
			const stats = await evaluate(adapter, "JSON.stringify(window.__probe.stop())");
			const s = stats as { p95: number; frames: number };
			rows.push({ arm, overlayFps: row.overlay, probeFps: row.probe, p95: s.p95, frames: s.frames });
			if (arm === "shown") {
				text = row.text;
				const after = row.layout as typeof before;
				if (JSON.stringify(before) !== JSON.stringify(after)) {
					console.log(`reflow FAIL before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
					return 1;
				}
			}
			const shownRate = arm === "shown" ? `overlayFps=${row.overlay.toFixed(2)}` : "overlayFps=n/a (sampler off)";
			console.log(`arm ${arm.padEnd(6)} ${shownRate} probeFps=${row.probe.toFixed(2)} p95=${s.p95.toFixed(2)}ms frames=${s.frames} elapsed=${((performance.now() - t0) / 1000).toFixed(2)}s visible=${row.visible} visibility=${row.visibility}`);
		}

		await captureOverlay(platform, () => {
			S.vq1(win, "setCollectionBehavior:", 1);
			native.perf_occlusion(web, 0);
		});
		console.log(`overlay rendered text:\n${text}`);
		const shown = rows.filter((r) => r.arm === "shown");
		const hiddenP95 = rows.filter((r) => r.arm === "hidden").map((r) => r.p95);
		const shownP95 = shown.map((r) => r.p95);
		const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
		const errors = shown.map((r) => {
			const pct = r.probeFps === 0 ? 100 : (Math.abs(r.overlayFps - r.probeFps) / r.probeFps) * 100;
			console.log(`fps check ${r.overlayFps.toFixed(2)} vs ${r.probeFps.toFixed(2)} = ${pct.toFixed(2)}% off`);
			return pct;
		});
		const agree = errors.every((pct) => pct <= 5) && shown.every((r) => r.frames > 0);
		console.log(`median p95 hidden=${median(hiddenP95).toFixed(2)}ms shown=${median(shownP95).toFixed(2)}ms delta=${(median(shownP95) - median(hiddenP95)).toFixed(2)}ms`);
		console.log(`control spread hidden=${spread(hiddenP95).toFixed(2)}ms shown=${spread(shownP95).toFixed(2)}ms`);
		console.log(`verify fps within5%=${agree} worst=${Math.max(...errors).toFixed(2)}%`);
		return agree ? 0 : 1;
	} finally {
		cleanup();
		process.removeListener("exit", cleanup);
		await bridge?.stop();
		await rm(scratch, { recursive: true, force: true });
	}
}

let code = 1;
try {
	code = await main();
} catch (error) {
	console.log(`overlay-probe: FAIL ${error instanceof Error ? error.message : String(error)}\n${error instanceof Error ? error.stack ?? "" : ""}`);
}
process.exit(code);
