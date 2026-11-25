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
import {
	disableOcclusion,
	keepAwake,
	occlusionHolds,
	occlusionSelectorAvailable,
	reassertOcclusion,
	releaseOcclusion,
} from "./testing-live-occlusion.ts";
import { LIVE_PAGE } from "./testing-live-page.ts";

const LIVE_NAME = "click, type and console work in a real WKWebView";
const SKIP_NAME = `${LIVE_NAME} — skipped: private WebKit _setWindowOcclusionDetectionEnabled: is unavailable on this macOS, so the occluded page draws no frames and no evaluate can be trusted`;
const occlusionAvailable = await occlusionSelectorAvailable();

const before = process.platform === "darwin" ? await captureFrontmost() : undefined;

describe("a live page", () => {
	test.skipIf(!occlusionAvailable)(
		occlusionAvailable ? LIVE_NAME : SKIP_NAME,
		async () => {
			if (process.platform !== "darwin") {
				// A platform with no WKWebView cannot evaluate at all; the plugin's refusal is proven in
				// testing.test.ts, so there is nothing live to measure here.
				expect(true).toBe(true);
				return;
			}
			const { DarwinPlatform } = await import("../platform/darwin/platform.ts");
			const { shim } = await import("../platform/darwin/index.ts");
			const { PAGE_BRIDGE_SOURCE } =
				await import("../platform/darwin/content-world-source.ts");
			const { darwinTestingAdapter, setTestingTimeoutFrames, setTestingTimeoutSignals } =
				await import("./testing-darwin.ts");
			const { createTestingPlugin } = await import("./testing.ts");

			let frames = 0;
			let heartbeat = 0;
			let visibility = "n/a";
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (req) => {
					const u = new URL(req.url);
					if (u.pathname === "/frames") {
						frames = Number(u.searchParams.get("n") ?? 0);
						return new Response("ok");
					}
					if (u.pathname === "/heartbeat") {
						heartbeat = Number(u.searchParams.get("n") ?? 0);
						visibility = u.searchParams.get("v") ?? "n/a";
						return new Response("ok");
					}
					return new Response(LIVE_PAGE, {
						headers: { "content-type": "text/html; charset=utf-8" },
					});
				},
			});
			const platform = new DarwinPlatform({ appName: "crust-testing", activate: "never" });
			let win = 0;
			let web = 0;
			let primeHolder: symbol | undefined;
			try {
				await platform.start();
				platform.pump(16);
				// A configuration of this test's own: `webviewConfiguration()` is the app-wide one, and
				// installing on it would leave every later test in this process believing its bridge is
				// already there (measured: content-world's "refuses a URL with no token" then saw 2 scripts).
				const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
				web = Number(shim().symbols.shim_webview_new(configuration, 480, 320) ?? 0);
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
				win = Number(
					shim().symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0,
				);
				expect(win).toBeGreaterThan(0);
				S.v1(win, "setContentView:", web);
				// A view WebKit never composited never calls the eval completion handler — the same
				// mechanism that makes window.capture answer no-completion. Hold the composited bit for
				// this test's whole lifetime through the same ref-counted owner capture uses; an absent
				// selector is a hard failure here, never a skip.
				const { darwinSnapshotShim } = await import("../platform/darwin/snapshot.ts");
				const { primeOwner } = await import("../platform/darwin/occlusion.ts");
				const primeShim = darwinSnapshotShim();
				expect(primeShim.primeAvailable?.(web)).toBe(true);
				primeHolder = Symbol("testing-live composited bit");
				expect(
					primeOwner.acquire(web, primeHolder, (target, enabled) =>
						Boolean(primeShim.prime?.(target, !enabled)),
					),
				).toBe(true);
				// Trap: WebKit suspends rendering for a window it considers occluded, and a suspended
				// webview never services the evaluate callback — "the page did not answer". This window
				// is off every display, so the page boots `visibilityState=hidden` with zero frames
				// unless this private selector is applied. Before orderFrontRegardless: WebKit caches
				// occlusion at first visibility. Dev-only scaffold, never a shipped default;
				// scripts/perf/in-process.ts applies the same remedy for the same reason.
				// macOS may nap the WebContent process while our own pump keeps ticking; hold the same
				// NSProcessInfo activity the perf recorder uses, for the whole test.
				expect(keepAwake()).toBe(1);
				// The owner records this override, so a capture that opts in shares the count instead of
				// re-enabling detection under this running page.
				expect(disableOcclusion(web)).toBe(true);
				expect(occlusionHolds(web)).toBe(1);
				// Public counterpart from scripts/perf/in-process.ts: join the active Space without
				// activating the app, or WebKit still keeps the display link idle.
				S.vq1(win, "setCollectionBehavior:", 1);
				S.v0(win, "orderFrontRegardless");
				// Re-assert at first visibility; WebKit caches occlusion there (perf/launch.ts does this).
				reassertOcclusion(web);
				expect(occlusionHolds(web)).toBe(1);
				expect(Number(shim().symbols.shim_webview_load(web, cstr(url)) ?? 0)).toBe(1);

				const plugin = createTestingPlugin(
					darwinTestingAdapter((label) => {
						if (label !== undefined && label !== "main") {
							throw new CrustError("bad-request", `no window labelled ${label}`);
						}
						return web;
					}),
				);
				setTestingTimeoutFrames(() => frames);
				setTestingTimeoutSignals({
					visibility: () => visibility,
					heartbeat: () => heartbeat,
				});
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

				// The completion is the regression, not a boolean on whatever the page said: a page
				// that never answers times out here, so this still fails for a genuinely dead page.
				const trivial = await darwinTestingAdapter(() => web).evaluate(
					undefined,
					"String(2 + 2)",
				);
				expect(trivial).toBe("4");

				const captured = await plugin.commands.console({});
				expect("hooked" in captured && captured.hooked).toBe(true);
				const lines =
					"entries" in captured
						? captured.entries.map((entry) => entry.args.join(" "))
						: [];
				expect(lines).toContain("page ready");
			} finally {
				releaseOcclusion(web);
				expect(occlusionHolds(web)).toBe(0);
				if (primeHolder !== undefined) {
					const { primeOwner } = await import("../platform/darwin/occlusion.ts");
					primeOwner.release(web, primeHolder);
					expect(primeOwner.holds(web)).toBe(0);
				}
				if (win) S.v0(win, "close");
				platform.stopPump();
				server.stop(true);
			}
			// Must exceed the product's 30 s liveness budget plus the remaining commands. This is not
			// a way to hide a failure: a page that never answers still fails at the eval deadline, and
			// that case is asserted without a webview in testing-eval-deadline.test.ts. With the view
			// composited, eval settles in tens of ms, so the 30 s budget could go back to the honest
			// pre-workaround value once that lane owns the change; this test's timeout stays as it was.
		},
		90_000,
	);
});

afterAll(async () => {
	await restoreFocus(before);
});
