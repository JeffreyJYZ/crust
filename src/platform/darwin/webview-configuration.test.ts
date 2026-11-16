/**
 * The one thing the network adapter needs from a window: the `WKWebViewConfiguration` its webview
 * is built from. WebKit copies that configuration at creation, so a `WKURLSchemeHandler` registered
 * later never reaches an existing webview (measured 2026-11-16), which makes "the webview is built
 * from a configuration" the whole precondition for `crust-net` working in a real app.
 * Both halves are checked: the source says which initializer is used, and the runtime says the
 * object handed in is a real `WKWebViewConfiguration` that accepts a handler without raising.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shim } from "./index.ts";
import { darwinNetworkAdapter } from "./network.ts";
import { webviewConfiguration } from "./webview-configuration.ts";

const DIR = import.meta.dir;
const read = (path: string): string => readFileSync(join(DIR, path), "utf8");

/** A scheme nothing else in this process registers: registering one twice aborts, not fails. */
const TEST_SCHEME = "crust-webview-test";

describe("the webview is built from a configuration", () => {
	test("the C unit uses -initWithFrame:configuration:, never a bare -init", () => {
		const c = read("shim/30_webview.c");
		expect(c).toContain("shim_webview_configuration");
		expect(c).toContain("initWithFrame:configuration:");
		// The defect this replaces: `[[WKWebView alloc] init]` builds WebKit's own
		// configuration, which no handler can ever be registered on.
		expect(c).not.toMatch(/sel_registerName\("init"\)[\s\S]{0,80}WKWebView/);
	});

	test("window creation hands the platform's configuration to that initializer", () => {
		const window = read("window-create.ts");
		expect(window).toContain("shim_webview_new(webviewConfiguration(), 0, 0)");
		expect(window).not.toContain('allocInit("WKWebView")');
	});
});

describe("the configuration is the one a handler registers on", () => {
	test("the platform hands out one WKWebViewConfiguration, stable across calls", () => {
		const first = webviewConfiguration();
		expect(first).toBeGreaterThan(0);
		// One configuration for the process: a second window built from a different one would
		// miss every handler registered on the first.
		expect(webviewConfiguration()).toBe(first);
		const name = String(shim().symbols.shim_class_name(first) ?? "");
		expect(name).toBe("WKWebViewConfiguration");
	});

	/**
	 * The real precondition, in the app's own order: register first, build the webview second.
	 * A refusal here means `setURLSchemeHandler:forURLScheme:` raised — which is a SIGABRT in a
	 * launch, so this is the check that the feature is reachable at all.
	 */
	test("setURLSchemeHandler:forURLScheme: lands on it without raising", () => {
		const adapter = darwinNetworkAdapter({ configuration: webviewConfiguration });
		const landed = adapter.install(TEST_SCHEME, () => ({ action: "block" }));
		expect(landed).toEqual({ ok: true, reason: "registered" });
	});

	test("a webview built from it is a WKWebView, and a nil configuration is refused", () => {
		const symbols = shim().symbols;
		expect(Number(symbols.shim_webview_new(0, 0, 0) ?? 0)).toBe(0);
		const web = Number(symbols.shim_webview_new(webviewConfiguration(), 0, 0) ?? 0);
		expect(web).toBeGreaterThan(0);
		expect(String(symbols.shim_class_name(web) ?? "")).toBe("WKWebView");
	});
});
