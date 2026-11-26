/**
 * Process A's half of the offscreen harness: an accessory window at -4000,-4000, a simple page, and
 * the three captures. Nothing here activates, orders, moves or resizes a window for a picture.
 */
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { capture, type Shot } from "../capture-fullscreen/shot.ts";

export const PAGE = `<!doctype html><meta charset="utf-8"><title>offscreen capture probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>
<script>fetch("/ready")</script>`;

export interface Subject {
	web: number;
	win: number;
	platform: DarwinPlatform;
	stop: () => void;
}

/** `platform.start()` prints two diagnostics; A's stdout is one JSON line, so redirect them. */
async function quietStart(platform: DarwinPlatform): Promise<void> {
	const log = console.log;
	console.log = (...args: unknown[]) => process.stderr.write(`${args.join(" ")}\n`);
	try {
		await platform.start();
	} finally {
		console.log = log;
	}
}

/** Build the never-composited accessory window and prove the page actually loaded. */
export async function createSubject(): Promise<Subject> {
	const platform = new DarwinPlatform({ appName: "crust-offscreen-capture", activate: "never" });
	await quietStart(platform);
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1); // accessory: this process never activates
	const sh = shim();
	const configuration = Number(sh.symbols.shim_webview_configuration() ?? 0);
	const web = Number(sh.symbols.shim_webview_new(configuration, 480, 320) ?? 0);
	const win = Number(sh.symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
	if (!web || !win) throw new Error("webview or window creation returned null");
	let loaded = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			if (new URL(request.url).pathname === "/ready") {
				loaded = true;
				return new Response("ok");
			}
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		},
	});
	try {
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		sh.symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		platform.pump(16);
		const loadedBy = Date.now() + 5000;
		while (!loaded && Date.now() < loadedBy) await Bun.sleep(20);
		if (!loaded) throw new Error("probe page never loaded");
	} catch (thrown) {
		server.stop(true);
		platform.stopPump();
		throw thrown;
	}
	return { web, win, platform, stop: () => server.stop(true) };
}

/** A window's own Space and occlusion, read in A's process. */
export function state(win: number): { onActiveSpace: boolean; occlusionState: number } {
	return {
		onActiveSpace: S.b0(win, "isOnActiveSpace"),
		occlusionState: S.q0(win, "occlusionState"),
	};
}

/** One capture's timing, answer and decoded picture, with a number for every blank-png test. */
export function shotFacts(shot: Shot): Record<string, number | string> {
	const m = shot.measured;
	return {
		ms: shot.ms,
		answer: shot.answer,
		picture: shot.picture,
		width: shot.width,
		height: shot.height,
		scale: shot.scale,
		bytes: shot.bytes,
		pixels: m?.pixels ?? 0,
		opaque: m?.opaque ?? 0,
		colours: m?.colours ?? 0,
	};
}

/** The three modes, in the order that decides whether a picture needs priming. */
export async function threeCaptures(web: number) {
	return {
		bare: shotFacts(await capture(web)),
		ignoreOcclusion: shotFacts(await capture(web, { ignoreOcclusion: true })),
		prime: shotFacts(await capture(web, { prime: true })),
	};
}
