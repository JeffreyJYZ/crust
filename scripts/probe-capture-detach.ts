#!/usr/bin/env bun
/**
 * Public route: remove the webview from its window, snapshot, put it back — no private SPI.
 *
 *     bun run scripts/probe-capture-detach.ts suspended
 *     bun run scripts/probe-capture-detach.ts composited
 *
 * `suspended` idles 3000 ms at -4000,-4000 so the composited bit is absent; `composited` captures
 * before WebKit stops drawing, as the control. The page posts its own metrics every 100 ms, so
 * reflow, scroll and cadence are read from the page rather than inferred from the native side.
 * Nothing activates, no cursor moves, no Space changes. One JSON line per launch.
 */
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { snapshotUnit, takeSnapshot } from "@/platform/darwin/snapshot.ts";
import { guardFocus, restoreFocus } from "./e2e-harness.ts";
import { decodePng } from "./probe-capture-png.ts";

const MODES = ["suspended", "composited", "direct"];
const PAGE = `<!doctype html><meta charset="utf-8"><title>detach probe</title>
<style>html,body{margin:0}i{display:block;height:25%}#tall{height:5000px}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i><div id="tall"></div>
<script>
var m={resize:0,blur:0,focus:0,timer:0,raf:0,w:innerWidth,h:innerHeight,scroll:0,vis:document.visibilityState};
addEventListener('resize',function(){m.resize++});
addEventListener('blur',function(){m.blur++});
addEventListener('focus',function(){m.focus++});
(function tick(){m.raf++;requestAnimationFrame(tick)})();
setInterval(function(){m.timer++;m.w=innerWidth;m.h=innerHeight;m.scroll=scrollY;
 fetch('/metrics?d='+encodeURIComponent(JSON.stringify(m)))},100);
scrollTo(0,120);
</script>`;

interface Metric {
	t: number;
	resize: number;
	blur: number;
	focus: number;
	timer: number;
	raf: number;
	w: number;
	h: number;
	scroll: number;
	vis: string;
}

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
	const platform = new DarwinPlatform({ appName: "crust-detach-probe", activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1);
	const sh = shim();
	const configuration = Number(sh.symbols.shim_webview_configuration() ?? 0);
	const web = Number(sh.symbols.shim_webview_new(configuration, 480, 320) ?? 0);
	const win = Number(sh.symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
	const metrics: Metric[] = [];
	let ready = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/metrics") {
				metrics.push({ t: Date.now(), ...JSON.parse(url.searchParams.get("d") ?? "{}") });
				return new Response("ok");
			}
			if (url.pathname === "/ready") {
				ready = true;
				return new Response("ok");
			}
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		},
	});
	const frame = (): number[] =>
		[0, 1, 2, 3].map((i) => Number(sh.symbols.shim_window_frame_num(web, i) ?? NaN));
	let result = "";
	let ms = -1;
	let width = 0;
	let height = 0;
	let opaque = 0;
	let colours = 0;
	let error = "";
	let beforeNative: Record<string, number | string> = {};
	let afterNative: Record<string, number | string> = {};
	try {
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		sh.symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		platform.pump(16);
		const up = Date.now() + 4000;
		while (!ready && Date.now() < up) await Bun.sleep(20);
		await Bun.sleep(mode === "suspended" ? 3000 : 200);
		const detaching = mode !== "direct";
		beforeNative = {
			frame: frame().join(","),
			autoresizing: S.q0(web, "autoresizingMask"),
			firstResponder: S.p0(win, "firstResponder") === web ? 1 : 0,
			composited: Number(snapshotUnit().symbols.crust_shot_composited(web) ?? -1),
		};
		const baseline = metrics.at(-1);
		const detach = Date.now();
		if (detaching) S.v0(web, "removeFromSuperview");
		const detachMs = detaching ? Date.now() - detach : 0;
		const capture = Date.now();
		try {
			const shot = await takeSnapshot(web, undefined, 2500);
			ms = Date.now() - capture;
			const measured = decodePng(Buffer.from(shot.png, "base64"));
			width = measured.width;
			height = measured.height;
			opaque = measured.opaque;
			colours = measured.colours;
			result = opaque > 0 && colours > 1 ? "real" : "blank";
		} catch (thrown) {
			ms = Date.now() - capture;
			error = thrown instanceof Error ? thrown.message : String(thrown);
			result = "failed";
		}
		const reattach = Date.now();
		if (detaching) S.v1(win, "setContentView:", web);
		const reattachMs = detaching ? Date.now() - reattach : 0;
		await Bun.sleep(600);
		afterNative = {
			frame: frame().join(","),
			autoresizing: S.q0(web, "autoresizingMask"),
			firstResponder: S.p0(win, "firstResponder") === web ? 1 : 0,
			composited: Number(snapshotUnit().symbols.crust_shot_composited(web) ?? -1),
		};
		console.log(
			JSON.stringify({
				mode,
				result,
				detachMs,
				captureMs: ms,
				reattachMs,
				width,
				height,
				opaque,
				colours,
				error,
				beforeNative,
				afterNative,
				baseline,
				after: metrics.at(-1),
				metricSamples: metrics.length,
			}),
		);
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
