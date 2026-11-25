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

export interface LaunchedApp {
	occlusionDetectionEnabled: boolean;
	occlusionState: number;
	keepAwake: boolean;
	/** Re-assert the private selectors; a transient app switch re-suspends rAF. */
	reassert(): void;
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
	const onExit = (): void => {
		cleanupSync();
		restoreFocus();
	};
	const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
	const handlers = new Map<(typeof signals)[number], () => void>();
	const onSignal = (signal: (typeof signals)[number]): void => {
		cleanupSync();
		process.kill(process.pid, signal);
	};
	process.on("exit", onExit);
	for (const signal of signals) {
		const handler = (): void => onSignal(signal);
		handlers.set(signal, handler);
		process.on(signal, handler);
	}
	const detach = (): void => {
		process.removeListener("exit", onExit);
		for (const signal of signals) {
			const handler = handlers.get(signal);
			if (handler !== undefined) process.removeListener(signal, handler);
		}
	};

	let restoreFocus = (): void => {};
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
		const { S, cls } = await import("@/platform/darwin/objc.ts");
		const nsApp = S.p0(cls("NSApplication"), "sharedApplication", true);
		const workspace = S.p0(cls("NSWorkspace"), "sharedWorkspace", true);
		const previous = S.p0(workspace, "frontmostApplication");
		if (previous !== 0) S.p0(previous, "retain");
		let restored = false;
		restoreFocus = (): void => {
			if (restored || previous === 0) return;
			restored = true;
			// NSApplicationActivateAllWindows, not the deprecated ignoring-other-apps bit.
			S.v1(previous, "activateWithOptions:", 1);
			S.v0(previous, "release");
		};
		// WKWebView suspends rAF once AppKit marks the window fully occluded. The private
		// _setWindowOcclusionDetectionEnabled:NO selector alone holds for about two seconds; the
		// window has to stay on screen and key for the whole run. Re-assert every tick, because a
		// person switching apps can take the front back mid-run. Focus is returned at stop().
		const reassert = (): void => {
			S.vq1(win, "setLevel:", 3); // NSFloatingWindowLevel
			S.vq1(win, "setCollectionBehavior:", 130); // moveToActiveSpace | fullScreenPrimary
			S.v1(nsApp, "activateIgnoringOtherApps:", 1);
			S.v1(win, "makeKeyAndOrderFront:", 0);
			S.vq1(win, "setLevel:", 3); // ordering can drop the level
			native.perf_occlusion(web, 0);
		};
		reassert();
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
			restoreFocus();
			detach();
			resetActivationPolicy();
			await bridge?.stop();
		};
		return {
			occlusionDetectionEnabled: !disabled,
			occlusionState,
			keepAwake,
			reassert,
			evaluate: (source: string) => adapter.evaluate("main", source),
			stop,
		};
	} catch (error) {
		cleanupSync();
		restoreFocus();
		process.removeListener("exit", onExit);
		for (const signal of signals) process.removeAllListeners(signal);
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
