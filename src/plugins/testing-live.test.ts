/**
 * The live proof for `crust:testing`: a real `WKWebView`, a real page, a real click and a real
 * `type`, read back through `query`, plus the console tap capturing a line the page logged before
 * any command ran.
 *
 * Nothing is activated and no cursor moves: the app is built with `activate: "never"`, the window is
 * borderless and ordered front off every display (-4000, -4000), which is the arrangement
 * `network-probe.ts` measured as "visible to WebKit, appears nowhere". Focus is still handed back at
 * the end, because a probe that leaves the human looking at a test window is a defect whether or not
 * the window was theirs.
 */

import { afterAll, describe, expect, test } from "bun:test";

import { captureFrontmost, restoreFocus } from "../../scripts/harness/focus";
import { CrustError } from "../bridge/errors";
import { cstr, S } from "../platform/darwin/objc";

const PAGE = `<!doctype html>
<html><body>
<button id="go" onclick="document.getElementById('out').textContent='clicked'">go</button>
<input id="name" />
<div id="state"></div>
<div id="out">idle</div>
<script>
	window.__state = "";
	var input = document.getElementById("name");
	var state = document.getElementById("state");
	var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
	var tracked = input.value;
	Object.defineProperty(input, "value", {
		configurable: true,
		get: function () { return proto.get.call(this); },
		set: function (value) { tracked = String(value); proto.set.call(this, value); }
	});
	input.addEventListener("input", function () {
		var value = proto.get.call(input);
		if (value === tracked) return;
		tracked = value;
		window.__state = value;
		state.textContent = value;
	});
	console.log("page ready");
</script>
</body></html>`;

const before = process.platform === "darwin" ? await captureFrontmost() : undefined;

describe("a live page", () => {
	test("click, type and console work in a real WKWebView", async () => {
		if (process.platform !== "darwin") {
			// A platform with no WKWebView cannot evaluate at all; the plugin's refusal is proven in
			// testing.test.ts, so there is nothing live to measure here.
			expect(true).toBe(true);
			return;
		}
		const { DarwinPlatform } = await import("../platform/darwin/platform.ts");
		const { shim } = await import("../platform/darwin/index.ts");
		const { PAGE_BRIDGE_SOURCE } = await import("../platform/darwin/content-world-source.ts");
		const { darwinTestingAdapter } = await import("./testing-darwin.ts");
		const { createTestingPlugin } = await import("./testing.ts");

		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
		});
		const platform = new DarwinPlatform({ appName: "crust-testing", activate: "never" });
		let win = 0;
		try {
			await platform.start();
			platform.pump(16);
			// A configuration of this test's own: `webviewConfiguration()` is the app-wide one, and
			// installing on it would leave every later test in this process believing its bridge is
			// already there (measured: content-world's "refuses a URL with no token" then saw 2 scripts).
			const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
			const web = Number(shim().symbols.shim_webview_new(configuration, 480, 320) ?? 0);
			expect(web).toBeGreaterThan(0);
			// The same page-world script the bridge installs: the console tap plus `crustInvoke`.
			const page = Number(shim().symbols.shim_content_world_named(0) ?? 0);
			expect(
				Number(
					shim().symbols.shim_webview_add_user_script(
						web,
						page,
						cstr(PAGE_BRIDGE_SOURCE),
						1,
					) ?? 0,
				),
			).toBeGreaterThan(0);
			const url = `http://127.0.0.1:${server.port}/`;
			win = Number(shim().symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
			expect(win).toBeGreaterThan(0);
			S.v1(win, "setContentView:", web);
			S.v0(win, "orderFrontRegardless");
			expect(Number(shim().symbols.shim_webview_load(web, cstr(url)) ?? 0)).toBe(1);

			const plugin = createTestingPlugin(
				darwinTestingAdapter((label) => {
					if (label !== undefined && label !== "main") {
						throw new CrustError("bad-request", `no window labelled ${label}`);
					}
					return web;
				}),
			);
			const ready = await plugin.commands.waitFor({ selector: "#go", timeoutMs: 8000 });
			expect(ready).toMatchObject({ ok: true, found: true });

			const clicked = await plugin.commands.click({ selector: "#go" });
			expect(clicked).toEqual({ ok: true, clicked: true, verified: true });
			const out = await plugin.commands.query({ selector: "#out" });
			expect(out).toMatchObject({ ok: true, exists: true, text: "clicked" });

			const typed = await plugin.commands.type({ selector: "#name", text: "hello" });
			expect(typed).toEqual({ ok: true, value: "hello" });
			const field = await plugin.commands.query({ selector: "#name" });
			expect(field).toMatchObject({ ok: true, value: "hello" });
			const state = await plugin.commands.query({ selector: "#state" });
			expect(state).toMatchObject({ ok: true, text: "hello" });

			// The control, in the same page: a plain assignment keeps the tracker in step, so the
			// framework never hears about it — which is the trap `type` exists to avoid.
			await darwinTestingAdapter(() => web).evaluate(
				undefined,
				`document.getElementById("name").value = "direct"; document.getElementById("name").dispatchEvent(new Event("input")); "ok"`,
			);
			const after = await plugin.commands.query({ selector: "#state" });
			expect(after).toMatchObject({ ok: true, text: "hello" });

			const captured = await plugin.commands.console({});
			expect("hooked" in captured && captured.hooked).toBe(true);
			const lines =
				"entries" in captured ? captured.entries.map((entry) => entry.args.join(" ")) : [];
			expect(lines).toContain("page ready");
		} finally {
			if (win) S.v0(win, "close");
			platform.stopPump();
			server.stop(true);
		}
	}, 30000);
});

afterAll(async () => {
	await restoreFocus(before);
});
