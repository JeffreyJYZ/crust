/**
 * The recorder's private launch path. It boots the bridge and one WebKit window in-process, then
 * disables WebKit's window-occlusion detection with the harness's private selector BEFORE the first
 * page evaluate. Shipped apps never take this path; no focus is stolen and no screenshot is taken.
 */

import { windowUrl } from "@/app-windows.ts";
import { startBridge } from "@/bridge/server.ts";
import { darwinTestingAdapter } from "@/plugins/testing-darwin.ts";
import { resetActivationPolicy, setTestingActivation } from "@/plugins/activation-policy.ts";
import { createPerfPlugin } from "@/plugins/perf.ts";
import { createWindowPlugin } from "@/plugins/window.ts";
import { darwinWindowAdapter } from "@/platform/darwin/window-adapter.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import type { Collector } from "@/perf";
import { perfNative } from "./perf-native.ts";
import { processSignalHooks, trapSignals } from "./signals.ts";

export interface LaunchedApp {
	occlusionDetectionEnabled: boolean;
	occlusionState: number;
	keepAwake: boolean;
	/** Re-assert the private selectors; a transient app switch re-suspends rAF. */
	reassert(): void;
	/** Live AppKit occlusion state; bit 2 means the window is composited. */
	occlusionNow(): number;
	evaluate(source: string): Promise<unknown>;
	stop(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function launchApp(
	root: string,
	collector: Collector,
	appName: string,
): Promise<LaunchedApp> {
	if (process.platform !== "darwin") {
		throw new Error("perf record needs macOS/WebKit: an occluded window renders zero frames");
	}
	setTestingActivation("none");
	collector.setSinks({ file: true });
	const native = perfNative();
	let platform: DarwinPlatform | undefined;
	let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
	let stopped = false;
	const cleanupSync = (): void => {
		try {
			platform?.destroy("main");
			platform?.stopPump();
		} catch {
			// An exit trap cannot report, and the window may already be gone.
		}
	};
	const trap = trapSignals(processSignalHooks, cleanupSync);

	try {
		platform = new DarwinPlatform({ appName, activate: "never" });
		bridge = startBridge({
			handlers: [
				createPerfPlugin(collector),
				createWindowPlugin(darwinWindowAdapter(platform)),
			],
			root,
		});
		await platform.start();
		platform.pump(16);
		const url = windowUrl({ label: "main", url: "/" }, undefined, bridge);
		platform.createWindow({
			label: "main",
			url,
			width: 900,
			height: 640,
			title: appName,
			activate: false,
		});
		const web = platform.webview("main");
		const win = platform.nativeWindow("main");
		if (web === undefined || win === undefined)
			throw new Error("recorder window has no webview");
		const { S } = await import("@/platform/darwin/objc.ts");
		// A created-but-never-ordered window can report visible while WebKit keeps its display
		// link idle. `orderFrontRegardless` brings it in without activation: no focus is stolen,
		// and the private occlusion selector is re-applied on every tick in case WebKit caches it
		// at the first visibility change.
		const reassert = (): void => {
			// Keep the probe above an app the human switches to; no activation, so no focus theft.
			S.vq1(win, "setLevel:", 3); // NSFloatingWindowLevel
			S.v0(win, "orderFrontRegardless");
			native.perf_occlusion(web, 0);
		};
		reassert();
		const occlusionNow = (): number => Number(native.perf_occlusion_state(win));
		const disabled = native.perf_occlusion(web, 0) === 1;
		if (!disabled)
			throw new Error("private WebKit occlusion selector absent: rAF would be suspended");
		const keepAwake = native.perf_keep_awake() === 1;
		const occlusionState = Number(native.perf_occlusion_state(win));
		const adapter = darwinTestingAdapter((label) =>
			label === undefined || label === "main" ? web : null,
		);
		const stop = async (): Promise<void> => {
			if (stopped) return;
			stopped = true;
			cleanupSync();
			trap.detach();
			resetActivationPolicy();
			await bridge?.stop();
		};
		return {
			occlusionDetectionEnabled: !disabled,
			occlusionState,
			keepAwake,
			reassert,
			occlusionNow,
			evaluate: (source: string) => adapter.evaluate("main", source),
			stop,
		};
	} catch (error) {
		cleanupSync();
		trap.detach();
		resetActivationPolicy();
		await bridge?.stop();
		throw error;
	}
}

/** Wait for the bridge client and the page before injecting the frame sampler. */
export async function waitForPage(app: LaunchedApp, timeoutMs = 6000): Promise<boolean> {
	const deadline = performance.now() + timeoutMs;
	let last = "no answer";
	while (performance.now() < deadline) {
		try {
			app.reassert();
			const state = await app.evaluate(
				"location.href + '/' + document.readyState + '/' + typeof window.crust + '/' + typeof window.crust?.invoke",
			);
			last = typeof state === "string" ? state : String(state);
			if (last.endsWith("/object/function")) {
				await sleep(100);
				return true;
			}
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		await sleep(200);
	}
	console.error(`crust perf record: page wait ended with ${last}`);
	return false;
}
