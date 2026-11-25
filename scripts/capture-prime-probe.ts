#!/usr/bin/env bun
/**
 * The real `prime` measurement in a child process: a never-composited window at -4000,-4000, a
 * first capture with `prime: true`, a second without, and the native state around both. Mode `eval`
 * sets the same composited bit before a trivial evaluateJavaScript, to answer whether the live-page
 * stall shares this cause. Nothing activates, moves a window online, changes a Space or moves the
 * cursor. One launch per mode, one JSON line.
 */
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { primeOwner } from "@/platform/darwin/occlusion.ts";
import {
	darwinSnapshotShim,
	PRIME_UNAVAILABLE,
	snapshotUnit,
	takeSnapshot,
} from "@/platform/darwin/snapshot.ts";
import { darwinTestingAdapter } from "@/plugins/testing-darwin.ts";
import { guardFocus, restoreFocus } from "./e2e-harness.ts";
import { decodePng } from "./probe-capture-png.ts";

const MODES = ["capture", "eval", "eval-control"];
const CAP_MS = 2500;
const PAGE = `<!doctype html><meta charset="utf-8"><title>prime probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>
<script>fetch("/ready")</script>`;

const deadline = (ms: number): Promise<"timeout"> =>
	new Promise((done) => setTimeout(() => done("timeout"), ms));

async function main(): Promise<void> {
	const mode = process.argv[2] ?? "";
	if (!MODES.includes(mode)) {
		console.log(JSON.stringify({ unreachable: `unknown mode ${JSON.stringify(mode)}` }));
		process.exit(2);
	}
	if (process.platform !== "darwin") {
		console.log(JSON.stringify({ unreachable: `no WKWebView on ${process.platform}` }));
		process.exit(0);
	}
	const frontmost = guardFocus();
	const platform = new DarwinPlatform({ appName: "crust-prime-live", activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1);
	const sh = shim();
	const symbols = snapshotUnit().symbols;
	const configuration = Number(sh.symbols.shim_webview_configuration() ?? 0);
	const web = Number(sh.symbols.shim_webview_new(configuration, 480, 320) ?? 0);
	const win = Number(sh.symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
	let ready = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			if (new URL(request.url).pathname === "/ready") {
				ready = true;
				return new Response("ok");
			}
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		},
	});
	const facts = (): Record<string, number> => ({
		x: Number(sh.symbols.shim_window_frame_num(win, 0) ?? NaN),
		y: Number(sh.symbols.shim_window_frame_num(win, 1) ?? NaN),
		w: Number(sh.symbols.shim_window_frame_num(win, 2) ?? NaN),
		h: Number(sh.symbols.shim_window_frame_num(win, 3) ?? NaN),
		alpha: Number(sh.symbols.shim_window_opacity(win) ?? -1),
		visible: Number(sh.symbols.shim_window_is_visible(win) ?? -1),
		onActiveSpace: Number(sh.symbols.shim_window_is_on_active_space(win) ?? -1),
		composited: Number(symbols.crust_shot_composited(web) ?? -1),
		holds: primeOwner.holds(web),
	});
	let report: Record<string, unknown> = {};
	try {
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		sh.symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		platform.pump(16);
		const up = Date.now() + 4000;
		while (!ready && Date.now() < up) await Bun.sleep(20);
		await Bun.sleep(3000);
		const before = facts();
		if (mode === "capture") {
			const started = Date.now();
			let width = 0;
			let height = 0;
			let opaque = 0;
			let colours = 0;
			let scale = 0;
			let error = "";
			try {
				const shot = await takeSnapshot(web, darwinSnapshotShim(), CAP_MS, { prime: true });
				scale = shot.scale;
				const measured = decodePng(Buffer.from(shot.png, "base64"));
				width = measured.width;
				height = measured.height;
				opaque = measured.opaque;
				colours = measured.colours;
			} catch (thrown) {
				error = thrown instanceof Error ? thrown.message : String(thrown);
			}
			const after = facts();
			// A second capture that did not ask for prime must see the bit cleared. It will stall;
			// that is expected, so only the bit and the decoded result are reported here.
			let second = "";
			try {
				await takeSnapshot(web, darwinSnapshotShim(), 60);
				second = "answered";
			} catch (thrown) {
				second = thrown instanceof Error ? thrown.message : String(thrown);
			}
			report = {
				mode,
				ready: ready ? 1 : 0,
				before,
				after,
				ms: Date.now() - started,
				width,
				height,
				opaque,
				colours,
				scale,
				error,
				secondCaptureComposited: Number(symbols.crust_shot_composited(web) ?? -1),
				second,
				primeUnavailable: PRIME_UNAVAILABLE,
			};
		} else {
			const real = darwinSnapshotShim();
			if (mode === "eval") real.prime!(web, true);
			const started = Date.now();
			let answer = "";
			try {
				answer = await Promise.race([
					darwinTestingAdapter(() => web)
						.evaluate(undefined, "'ok'")
						.then(String),
					deadline(CAP_MS),
				]);
			} catch (thrown) {
				answer = `error: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
			}
			const ms = Date.now() - started;
			if (mode === "eval") real.prime!(web, false);
			report = {
				mode,
				ready: ready ? 1 : 0,
				before,
				after: facts(),
				ms,
				result: answer === "timeout" ? "stalled" : `settled:${answer}`,
			};
		}
		console.log(JSON.stringify(report));
	} finally {
		if (win) S.v0(win, "close");
		server.stop(true);
		platform.stopPump();
		await restoreFocus(frontmost);
	}
	process.exit(0);
}

main().catch((thrown: unknown) => {
	console.log(JSON.stringify({ error: thrown instanceof Error ? thrown.message : String(thrown) }));
	process.exit(1);
});
