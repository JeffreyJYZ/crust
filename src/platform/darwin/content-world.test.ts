/**
 * The content world, its two user scripts and where each of them is installed.
 *
 * Nothing here opens a window: a `WKWebView` can be built without one, and registering the scripts
 * is the step that either works or raises. That makes the whole native half provable in the suite —
 * what a real page then sees is the e2e's job.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shim } from "./index.ts";
import { webviewConfiguration } from "./webview-configuration.ts";
import { contentWorldAvailable, installContentWorldBridge } from "./content-world.ts";
import { ptrValue, SEL, S } from "./objc.ts";
import { CONTENT_WORLD_SOURCE, PAGE_BRIDGE_SOURCE } from "./content-world-source.ts";

const DIR = import.meta.dir;

/** How many user scripts a webview's own controller holds, read through AppKit rather than assumed. */
function scriptsOn(web: number): number {
	const config = ptrValue(S.p0(web, "configuration"), "configuration");
	const controller = ptrValue(S.p0(config, "userContentController"), "userContentController");
	const scripts = ptrValue(S.p0(controller, "userScripts"), "userScripts");
	return Number(shim().symbols.shim_send_q0(scripts, SEL("count")) ?? -1);
}

describe("the world the token lives in", () => {
	test("`+[WKContentWorld worldWithName:]` answers one world, stable across calls", () => {
		expect(contentWorldAvailable()).toBe(true);
		const first = Number(shim().symbols.shim_content_world() ?? 0);
		expect(first).toBeGreaterThan(0);
		// One world per process, or a page would get two bridges with two different tokens.
		expect(Number(shim().symbols.shim_content_world() ?? 0)).toBe(first);
		expect(String(shim().symbols.shim_class_name(first) ?? "")).toBe("WKContentWorld");
	});

	test("install refuses a document whose URL carries no token", () => {
		const web = Number(shim().symbols.shim_webview_new(webviewConfiguration(), 0, 0) ?? 0);
		// A `crust dev` page gets `window.__CRUST__` from Vite and has no `?token=`, so the content
		// world has nothing to read and must not be installed: the fetch path stays in use.
		expect(installContentWorldBridge(web, "http://localhost:5173/")).toBe(false);
		expect(installContentWorldBridge(0, "http://127.0.0.1:1/?token=abc")).toBe(false);
	});

	test("both scripts land on a webview built from the app's configuration", () => {
		const web = Number(shim().symbols.shim_webview_new(webviewConfiguration(), 0, 0) ?? 0);
		expect(web).toBeGreaterThan(0);
		// One call installs both halves; false is the caller's cue to fall back to the fetch path.
		expect(installContentWorldBridge(web, "http://127.0.0.1:1/?token=abc")).toBe(true);
	});

	test("a second window does not stack a second copy of the scripts", () => {
		// Every window is built from the one shared configuration, so its controller is the same
		// object and WebKit hands those scripts to every webview built from it. Installing per
		// window put the isolated half on the page twice: the first copy scrubs `?token=` at
		// document start, the second reads an empty token and every call from the page raced a 401.
		const first = Number(shim().symbols.shim_webview_new(webviewConfiguration(), 0, 0) ?? 0);
		expect(installContentWorldBridge(first, "http://127.0.0.1:1/?token=abc")).toBe(true);
		const count = scriptsOn(first);
		expect(count).toBe(2);
		const second = Number(shim().symbols.shim_webview_new(webviewConfiguration(), 0, 0) ?? 0);
		expect(installContentWorldBridge(second, "http://127.0.0.1:1/?token=abc")).toBe(true);
		expect(scriptsOn(second)).toBe(2);
	});

	test("window creation installs the bridge before the URL is loaded", () => {
		const create = readFileSync(join(DIR, "window-create.ts"), "utf8");
		expect(create).toContain("installContentWorldBridge(web, url)");
		// The load must be the last step: WebKit copies the controller's script list when the
		// webview is created, and a page script that runs first sees no bridge at all.
		expect(create.indexOf("installContentWorldBridge(web, url)")).toBeLessThan(
			create.indexOf("shim_webview_load(web"),
		);
	});
});

describe("the two scripts say the right things", () => {
	test("the isolated half reads the token and scrubs it from the shared URL", () => {
		expect(CONTENT_WORLD_SOURCE).toContain('params.get("token")');
		expect(CONTENT_WORLD_SOURCE).toContain("history.replaceState");
		expect(CONTENT_WORLD_SOURCE).toContain("/_crust/invoke");
		expect(CONTENT_WORLD_SOURCE).toContain("_crust/events?token=");
	});

	test("the page half defines one function and never names a token", () => {
		expect(PAGE_BRIDGE_SOURCE).toContain("window.crustInvoke = function");
		expect(PAGE_BRIDGE_SOURCE).not.toContain("token");
		expect(PAGE_BRIDGE_SOURCE).not.toContain("authorization");
		expect(PAGE_BRIDGE_SOURCE).not.toContain("fetch");
	});
});
