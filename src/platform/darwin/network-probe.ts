/**
 * The runtime proof that `crust:network`'s allow path really serves bytes, run by hand:
 *
 *     bun run src/platform/darwin/network-probe.ts
 *
 * It is not a test, because it needs a live WebKit. It builds a `WKWebView` from a configuration
 * with the `crust-net` handler installed, then measures two things and prints both:
 *   main   — navigating the webview TO a `crust-net:` URL. WebKit calls the handler and commits the
 *            URL, then renders no document: a custom scheme cannot be the main resource.
 *   served — a page loaded over `about:blank` that pulls a `<script src>` and an `<img src>` through
 *            the scheme. Both are decoded from bytes the rule set carries, and the page reads them
 *            back into its own title.
 * Nothing is activated: the window is ordered front off every display and the app is an accessory,
 * so no window appears and no focus moves. `shim/114_network_probe.c` holds the sends this needs.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNetworkPlugin } from "@/plugins/network";
import { darwinNetworkAdapter, networkServed } from "./network";
import { BODY, DATA, PAGE, PIXEL, PREFIX, WIDTH } from "./network-probe-page";
import probeSource from "./shim/114_network_probe.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;
const V = FFIType.void;
const D = FFIType.f64;

const hash = createHash("sha256").update(probeSource).digest("hex").slice(0, 16);
const source = join(tmpdir(), `crust-network-probe-${hash}.c`);
if (!existsSync(source)) writeFileSync(source, probeSource);

const probe = cc({
	source,
	flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
	symbols: {
		net_probe_app: { args: [], returns: I32 },
		net_probe_config: { args: [], returns: P },
		net_probe_webview: { args: [P, D, D], returns: P },
		net_probe_window: { args: [P, D, D], returns: P },
		net_probe_show: { args: [P], returns: I32 },
		net_probe_load: { args: [P, P], returns: I32 },
		net_probe_title: { args: [P, P, I32], returns: I32 },
		net_probe_pump: { args: [D], returns: V },
	},
}).symbols as unknown as {
	net_probe_app: () => number;
	net_probe_config: () => number;
	net_probe_webview: (config: number, w: number, h: number) => number;
	net_probe_window: (web: number, w: number, h: number) => number;
	net_probe_show: (win: number) => number;
	net_probe_load: (web: number, url: number) => number;
	net_probe_title: (web: number, dst: number, cap: number) => number;
	net_probe_pump: (seconds: number) => void;
};

function text(call: (into: Uint8Array) => number): string {
	const buffer = new Uint8Array(1024);
	const length = call(buffer);
	return length <= 0 ? "" : new TextDecoder().decode(buffer.subarray(0, length));
}

/** Pump until the title settles on the shape the page writes, or the budget runs out. It yields to
 * Bun's event loop each turn, because the page is served by a `Bun.serve` in this same process and a
 * purely synchronous pump would starve it. */
async function awaitTitle(web: number, want: string): Promise<string> {
	let title = "";
	for (let turn = 0; turn < 300; turn++) {
		probe.net_probe_pump(0.02);
		title = text((into) => probe.net_probe_title(web, ptr(into), into.length));
		if (title.includes(want)) return title;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return title;
}

async function main(): Promise<void> {
	if (!probe.net_probe_app()) {
		console.log("network   unproved: AppKit did not answer, so there is no run loop");
		process.exit(1);
	}
	const configuration = probe.net_probe_config();
	const plugin = createNetworkPlugin(
		darwinNetworkAdapter({ configuration: () => configuration }),
	);
	const ctx = { emit: () => {} };
	const state = await plugin.commands.setRules(
		{
			rules: [
				{
					pattern: `${PREFIX}/data`,
					action: "allow",
					type: "application/javascript",
					body: DATA,
				},
				{ pattern: `${PREFIX}/text`, action: "allow", body: BODY },
				{ pattern: `${PREFIX}/pixel`, action: "allow", type: "image/svg+xml", body: PIXEL },
				{ pattern: "*", action: "block" },
			],
		},
		ctx,
	);
	if (!("registered" in state) || !state.registered) {
		console.log(
			`network   unproved: handler not registered — ${"reason" in state ? state.reason : "?"}`,
		);
		process.exit(1);
	}
	const web = probe.net_probe_webview(configuration, 480, 320);
	const window = web ? probe.net_probe_window(web, 480, 320) : 0;
	if (!web || !window || !probe.net_probe_show(window)) {
		console.log("network   unproved: the probe webview or its window was not built");
		process.exit(1);
	}

	// The negative half, measured rather than assumed: a custom scheme as the MAIN resource.
	const mainUrl = new TextEncoder().encode(`${PREFIX}/data\0`);
	probe.net_probe_load(web, ptr(mainUrl));
	const mainTitle = await awaitTitle(web, "never");

	// The proof: subresources served through the scheme, read back by the page itself. The page is
	// served over http from 127.0.0.1, the origin a crust app really has.
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
	});
	const pageUrl = new TextEncoder().encode(`http://127.0.0.1:${server.port}/\0`);
	if (!probe.net_probe_load(web, ptr(pageUrl))) {
		console.log("network   unproved: the page did not load");
		process.exit(1);
	}
	const title = await awaitTitle(web, `fetch=${BODY}`);
	server.stop(true);
	const served = networkServed();
	const log = await plugin.commands.log(undefined, ctx);
	const entries = "entries" in log ? log.entries : [];
	console.log(`network main=${JSON.stringify(mainTitle)}`);
	console.log(
		`network tasks ${entries.map((entry) => `${entry.url.slice(PREFIX.length)}:${entry.status}:${entry.bytes ?? 0}`).join(" ")}`,
	);
	const readBody = title.includes(`script=${BODY}`) ? BODY : "";
	const fetched = /fetch=([^ ]*)/.exec(title)?.[1] ?? "";
	const status = Number(/status=(\d+)/.exec(title)?.[1] ?? 0);
	const type = /type=(.*?) fetch=/.exec(title)?.[1] ?? "";
	const width = Number(/width=(\d+)/.exec(title)?.[1] ?? 0);
	const inline = Number(/inline=(\d+)/.exec(title)?.[1] ?? 0);
	const ok = readBody === BODY && fetched === BODY;
	console.log(`network served=${served.bytes} body=${readBody} tasks=${served.tasks}`);
	console.log(
		`network fetch=${JSON.stringify(fetched)} status=${status} type=${JSON.stringify(type)}`,
	);
	const imgState = /img=(\w+)/.exec(title)?.[1] ?? "none";
	console.log(`network img=${imgState} width=${width} inline=${inline}px`);
	console.log(
		`network ${ok ? "PASS" : "FAIL"} ${ok ? "the page read the served bytes" : `the page read ${JSON.stringify(title)}`}`,
	);
	process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
	console.log(`network   failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
