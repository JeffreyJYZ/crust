/**
 * The Windows adapter with its platform calls faked, so the child/surface/handle ordering and the
 * two gates' plumbing are provable without compiling C or sending WebView2 a COM call. The real shim
 * calls are proved by `scripts/windows/browser.ts` on the runner.
 */
import { describe, expect, test } from "bun:test";
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import { windowsBrowserAdapter } from "./browser";
import { FakePorts } from "./browser-fake";

const BOUNDS: BrowserBounds = { x: 10, y: 20, width: 640, height: 400 };
const STATE: BrowserState = {
	url: "http://127.0.0.1:4321/",
	title: "Remote Title",
	loading: false,
	canGoBack: false,
	canGoForward: false,
};

describe("windowsBrowserAdapter", () => {
	test("open builds the child, the controller and both handlers, then loads", () => {
		const fake = new FakePorts();
		const adapter = windowsBrowserAdapter(fake);
		expect(
			adapter.open({
				label: "docs",
				url: STATE.url,
				bounds: BOUNDS,
				owner: "main",
			}),
		).toEqual({
			ok: true,
			label: "docs",
		});
		expect(fake.calls).toEqual([
			"child:200:10,20,640,400",
			`surface:300:${STATE.url}`,
			"watch:1",
			"popups:1",
			"sink:set",
		]);
	});

	test("a refused navigation handler tears the child down instead of leaking a surface", () => {
		const fake = new FakePorts();
		fake.watchRefused = true;
		const adapter = windowsBrowserAdapter(fake);
		expect(adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
		expect(fake.calls).toContain("release:300");
	});

	test("a refused new-window handler is the same defect, not a silent popup", () => {
		const fake = new FakePorts();
		fake.popupRefused = true;
		const adapter = windowsBrowserAdapter(fake);
		expect(adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
		expect(fake.calls).toContain("release:300");
	});

	test("a failed load names the URL and removes the child", () => {
		const fake = new FakePorts();
		const adapter = windowsBrowserAdapter(fake);
		expect(
			adapter.open({
				label: "docs",
				url: `${STATE.url}refuse`,
				bounds: BOUNDS,
			}),
		).toMatchObject({ ok: false, code: "handler-error" });
		expect(fake.calls).toContain("release:300");
	});

	test("a duplicate label is refused before a second child exists", () => {
		const fake = new FakePorts();
		const adapter = windowsBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		const before = fake.calls.length;
		expect(adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS })).toMatchObject({
			ok: false,
			code: "bad-request",
		});
		expect(fake.calls.length).toBe(before);
	});

	test("state and setBounds read the surface, close ends it, every later call is not-found", () => {
		const fake = new FakePorts();
		const adapter = windowsBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		expect(adapter.state("docs")).toMatchObject({
			ok: true,
			title: "Remote Title",
		});
		const moved = { x: 1, y: 2, width: 3, height: 4 };
		expect(adapter.setBounds("docs", moved)).toEqual({ ok: true });
		expect(fake.calls).toContain("move:300:1,2,3,4");
		expect(adapter.navigate("docs", STATE.url)).toMatchObject({
			ok: true,
			loaded: true,
		});
		expect(adapter.close("docs")).toEqual({ ok: true, closed: true });
		expect(fake.calls).toContain("release:300");
		expect(adapter.state("docs")).toMatchObject({
			ok: false,
			code: "not-found",
		});
		expect(adapter.close("docs")).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("a window that closed prunes its surface rather than answering a stale title", () => {
		const fake = new FakePorts();
		fake.windowOpen = () => false;
		const adapter = windowsBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		expect(adapter.state("docs")).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("capture is refused by name: WebView2 has no render without an IStream", async () => {
		const fake = new FakePorts();
		const adapter = windowsBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		expect(await adapter.capture("docs")).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "ICoreWebView2::CapturePreview",
		});
		expect(await adapter.capture("gone")).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("external reports the opener's own answer", () => {
		const fake = new FakePorts();
		const adapter = windowsBrowserAdapter(fake);
		expect(adapter.external(`${STATE.url}popup`)).toEqual({ opened: true });
		expect(adapter.external(`${STATE.url}bad`)).toEqual({
			opened: false,
			reason: "ShellExecuteW refused",
		});
	});
});
