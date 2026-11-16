/**
 * `crust:navigation` command proofs that need no WebKit. Every test injects a fake adapter, so
 * nothing here installs a delegate on a real webview or loads a page — a test that opened a
 * window on a machine someone is using would be a defect, not a proof.
 * What is proven is the contract: every command answers a plain object, a refused send is a
 * typed failure, and nothing throws.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { collector, fakeNavigation, READY_STATE } from "@/plugins/navigation-fake.ts";
import {
	createNavigationPlugin,
	type NavigationAdapter,
	navigationPlugin,
} from "@/plugins/navigation.ts";

describe("navigation plugin commands", () => {
	test("not-implemented without an adapter, naming WKNavigationDelegate", async () => {
		const plugin = createNavigationPlugin();
		for (const result of [
			plugin.commands.start(undefined, collector().ctx),
			plugin.commands.stop(undefined, collector().ctx),
			plugin.commands.state(undefined, collector().ctx),
			plugin.commands.reload(undefined, collector().ctx),
			plugin.commands.goBack(undefined, collector().ctx),
			plugin.commands.goForward(undefined, collector().ctx),
		]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("WKNavigationDelegate");
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(navigationPlugin.name).toBe("navigation");
		expect(typeof navigationPlugin.commands.start).toBe("function");
	});

	test("start installs the delegate and reports the native status", () => {
		const { adapter, calls } = fakeNavigation({
			install: { ok: true, status: 0, reason: "installed" },
		});
		const result = createNavigationPlugin(adapter).commands.start(undefined, collector().ctx);
		expect(result).toEqual({ ok: true, status: 0, reason: "installed" });
		expect(calls).toEqual(["start"]);
	});

	test("a refused install is handler-error and keeps the adapter's reason", () => {
		const reason = "another navigation delegate is already set";
		const { adapter } = fakeNavigation({ install: { ok: false, status: 5, reason } });
		expect(createNavigationPlugin(adapter).commands.start(undefined, collector().ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: reason,
		});
	});

	test("stop removes the delegate", () => {
		const { adapter, calls } = fakeNavigation();
		expect(createNavigationPlugin(adapter).commands.stop(undefined, collector().ctx)).toEqual({
			ok: true,
			stopped: true,
		});
		expect(calls).toEqual(["stop"]);
	});

	test("state answers the webview's own readings", () => {
		const { adapter } = fakeNavigation();
		expect(createNavigationPlugin(adapter).commands.state(undefined, collector().ctx)).toEqual({
			ok: true,
			...READY_STATE,
		});
	});

	test("state without a webview is handler-error, naming what is missing", () => {
		const { adapter } = fakeNavigation({ state: null });
		expect(createNavigationPlugin(adapter).commands.state(undefined, collector().ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message:
				"navigation.state: there is no WKWebView yet; call start() after the window exists",
		});
	});

	test("reload, goBack and goForward report whether anything moved", () => {
		const { adapter, calls } = fakeNavigation({ reload: true, back: true, forward: false });
		const plugin = createNavigationPlugin(adapter);
		expect(plugin.commands.reload(undefined, collector().ctx)).toEqual({
			ok: true,
			reloaded: true,
		});
		expect(plugin.commands.goBack(undefined, collector().ctx)).toEqual({
			ok: true,
			moved: true,
		});
		expect(plugin.commands.goForward(undefined, collector().ctx)).toEqual({
			ok: true,
			moved: false,
		});
		expect(calls).toEqual(["reload", "goBack", "goForward"]);
	});

	test("an adapter that throws is a typed failure, never a rejected invoke", () => {
		const adapter: NavigationAdapter = {
			start: () => {
				throw new Error("the navigation C unit did not compile");
			},
			stop: () => {},
			state: () => {
				throw new Error("boom");
			},
			reload: () => {
				throw new Error("boom");
			},
			goBack: () => {
				throw new Error("boom");
			},
			goForward: () => {
				throw new Error("boom");
			},
		};
		const plugin = createNavigationPlugin(adapter);
		expect(plugin.commands.start(undefined, collector().ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "the navigation C unit did not compile",
		});
		expect(plugin.commands.reload(undefined, collector().ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "boom",
		});
		expect(plugin.commands.state(undefined, collector().ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "boom",
		});
	});
});
