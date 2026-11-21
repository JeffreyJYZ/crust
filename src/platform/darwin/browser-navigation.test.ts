/**
 * The adapter-boundary proof for `browser.origins`: the plugin decides, the platform must cancel.
 * The shared `checkNavigationDecision` opens a surface with a trusted origin and commits a foreign
 * URL the way a redirect would; an adapter that only stored the callback would answer with the
 * foreign URL and fail here. This file also pins that the native delegate actually owns the cancel
 * and that a refused `target=_blank` never reaches the system opener.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkNavigationDecision } from "@/plugins/browser-navigation-contract";
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import { darwinBrowserAdapter } from "./browser";
import type { BrowserPorts } from "./browser-ports";
import type { BrowserNative } from "./browser-unit";
import { fakeNavigation } from "./webview-target-fixture.ts";

const state: BrowserState = { url: "https://trusted.example/", title: "", loading: false, canGoBack: false, canGoForward: false };
const bounds: BrowserBounds = { x: 0, y: 0, width: 320, height: 200 };

function native(): BrowserNative {
	return {
		shim_browser_view_new: () => 0x100,
		shim_browser_view_set_frame: () => {},
		shim_browser_attach: () => 1,
		shim_browser_detach: () => {},
		shim_browser_view_release: () => {},
		shim_browser_ui_install: () => 0,
		shim_browser_ui_installed: () => 1,
		shim_browser_ui_uninstall: () => {},
		shim_browser_set_sink: () => {},
		shim_browser_popups: () => 0,
		shim_browser_popup_url: () => 0,
		shim_browser_capture_decision: () => 2,
	};
}

function ports(): BrowserPorts {
	return {
		native: native(),
		owner: (label) => ({ label: label ?? "main", win: 0x200 }),
		windowOpen: () => true,
		contentView: () => 0x300,
		newWebview: () => 0x400,
		addWebview: () => {},
		removeWebview: () => {},
		releaseView: () => {},
		load: () => 1,
		navNative: () => fakeNavigation().symbols,
		navInstall: () => 0,
		navUninstall: () => {},
		navState: () => state,
		opener: () => ({ status: 0, reason: "" }),
		snapshot: async () => ({ width: 1, height: 1, scale: 1, png: "cG5n" }),
	};
}

describe("the darwin surface obeys onNavigate", () => {
	test("a foreign commit is cancelled and the last good page stays", () => {
		expect(checkNavigationDecision(darwinBrowserAdapter(ports())).ok).toBe(true);
	});

	test("the popup handoff asks the same decision before calling the opener", () => {
		const p = ports();
		const opened: string[] = [];
		const adapter = darwinBrowserAdapter(p);
		adapter.open({
			label: "docs",
			url: "https://trusted.example/",
			bounds,
			onNavigate: (url) => url.startsWith("https://trusted.example"),
			onPopup: (url) => opened.push(url),
		});
		expect(adapter.external("http://169.254.169.254/latest/meta-data/").opened).toBe(false);
		expect(adapter.external("https://trusted.example/next").opened).toBe(true);
		expect(opened).toEqual([]);
	});

	test("the native delegate cancels through WebKit's decision handler, not a JS-only guard", () => {
		const read = (file: string) => readFileSync(join(import.meta.dir, "shim", file), "utf8");
		expect(read("107_navigation.c")).toContain(
			'sel_registerName("webView:decidePolicyForNavigationAction:decisionHandler:")',
		);
		const policy = read("110_navigation_policy.c");
		expect(policy).toContain("nav_policy_sink(web)");
		expect(policy).toContain("block->invoke(handler, allow ? 1LL : 0LL)");
	});
});
