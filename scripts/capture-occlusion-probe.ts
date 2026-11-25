#!/usr/bin/env bun
/**
 * One real `window.capture ignoreOcclusion` measurement in a CHILD process. The parent test spawns
 * this so AppKit's menu state never leaks into the rest of the suite. Accessory app, no activation,
 * window at -4000,-4000, no Space change. Prints one JSON line.
 */
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { darwinSnapshotShim, type SnapshotShim, takeSnapshot } from "@/platform/darwin/snapshot.ts";
import { inflateSync } from "node:zlib";
import { guardFocus, restoreFocus } from "./e2e-harness.ts";

const PAGE = `<!doctype html><meta charset="utf-8"><title>occlusion opt-in</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>`;

/** Enough of PNG to prove a picture: IHDR size plus distinct inflated byte values. */
function decode(png: Uint8Array): { width: number; height: number; colours: number } {
	let at = 8;
	let width = 0;
	let height = 0;
	const parts: Uint8Array[] = [];
	while (at + 8 <= png.length) {
		const length = (png[at]! << 24) | (png[at + 1]! << 16) | (png[at + 2]! << 8) | png[at + 3]!;
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		if (type === "IHDR") {
			width =
				(png[at + 8]! << 24) | (png[at + 9]! << 16) | (png[at + 10]! << 8) | png[at + 11]!;
			height =
				(png[at + 12]! << 24) |
				(png[at + 13]! << 16) |
				(png[at + 14]! << 8) |
				png[at + 15]!;
		}
		if (type === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
		if (type === "IEND") break;
		at += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(parts.map((part) => Buffer.from(part))));
	const colours = new Set<number>();
	for (let i = 1; i < raw.length; i += 97) colours.add(raw[i] ?? 0);
	return { width, height, colours: colours.size };
}

async function main(): Promise<void> {
	// Armed before AppKit starts. This probe never activates, but the guard also covers a killed run.
	const frontmost = guardFocus();
	const platform = new DarwinPlatform({ appName: "crust-occlusion-probe", activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
	});
	let win = 0;
	try {
		platform.pump(16);
		const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
		const web = Number(shim().symbols.shim_webview_new(configuration, 480, 320) ?? 0);
		win = Number(shim().symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		shim().symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		for (let i = 0; i < 30; i++) platform.pump(16);
		await Bun.sleep(150);
		const calls: string[] = [];
		const real = darwinSnapshotShim();
		const recording: SnapshotShim = {
			...real,
			take: (view, id) => {
				calls.push("take");
				return real.take(view, id);
			},
			occlusion: (view, enabled) => {
				calls.push(enabled ? "on" : "off");
				return real.occlusion!(view, enabled);
			},
		};
		const shot = await takeSnapshot(web, recording, 1800, { ignoreOcclusion: true });
		console.log(
			JSON.stringify({
				calls,
				...decode(Buffer.from(shot.png, "base64")),
				scale: shot.scale,
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

main().catch((error: unknown) => {
	console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
	process.exit(1);
});
