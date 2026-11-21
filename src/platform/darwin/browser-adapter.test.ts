/**
 * The darwin adapter with its platform calls faked, so the view/load/delegate ordering is provable
 * without compiling C or showing a window. The real unit and the real surface are proved by
 * `browser-unit.test.ts` and `scripts/e2e-browser.ts`; this file proves the wiring between them.
 */
import { describe, expect, test } from "bun:test";
import { darwinBrowserAdapter } from "./browser";
import { bounds, FakeNative, ports } from "./browser-adapter-fixture.ts";

describe("darwinBrowserAdapter", () => {
	test("open builds the host view, frames both views, installs both delegates and loads", () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		expect(
			adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds, owner: "main" }),
		).toEqual({
			ok: true,
			label: "docs",
		});
		expect(native.calls).toEqual([
			"view_new",
			"attach:300:100",
			"frame:100:10,20,640,400",
			"frame:400:0,0,640,400",
			"web:100:400",
			"ui:400",
		]);
		expect(native.sink).not.toBe(0);
	});

	test("a refused attach is a failure, not an invisible surface answered ok", () => {
		const native = new FakeNative();
		native.attachStatus = 0;
		const adapter = darwinBrowserAdapter(ports(native));
		const answer = adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		expect((answer as { message: string }).message).toContain("refused to attach");
		// The half-built surface is torn down: no webview, no frame, no delegate installed.
		expect(native.calls).toContain("detach:100");
		expect(native.calls).toContain("view-release:100");
		expect(native.calls).toContain("unweb:400");
		expect(native.calls).not.toContain("ui:400");
		expect(native.calls).not.toContain("web:100:400");
	});

	test("a refused UI delegate tears the host view down instead of leaking an unstyled surface", () => {
		const native = new FakeNative();
		native.uiStatus = 5;
		const adapter = darwinBrowserAdapter(ports(native));
		const answer = adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		expect(native.calls).toContain("detach:100");
	});

	test("a failed load is reported and the view removed", () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		const answer = adapter.open({ label: "docs", url: "http://127.0.0.1:4321/refuse", bounds });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		expect(native.calls).toContain("detach:100");
	});

	test("a duplicate label is refused before another webview is built", () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		const before = native.calls.length;
		const answer = adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
		expect(native.calls.length).toBe(before);
	});

	test("setBounds rewrites both frames and state reads the navigation unit", () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(adapter.setBounds("docs", { x: 1, y: 2, width: 3, height: 4 })).toEqual({
			ok: true,
		});
		expect(native.calls).toContain("frame:100:1,2,3,4");
		expect(native.calls).toContain("frame:400:0,0,3,4");
		expect(adapter.state("docs")).toMatchObject({ ok: true, title: "Remote Title" });
	});

	test("close releases every owned object, not just the superview retainer", () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(adapter.close("docs")).toEqual({ ok: true, closed: true });
		expect(native.calls).toContain("ui-uninstall:400");
		expect(native.calls).toContain("nav-uninstall:400");
		expect(native.calls).toContain("unweb:400");
		expect(native.calls).toContain("detach:100");
		expect(native.calls).toContain("view-release:100");
		expect(adapter.state("docs")).toMatchObject({ ok: false, code: "not-found" });
		expect(adapter.close("docs")).toMatchObject({ ok: false, code: "not-found" });
	});

	test("a refused delegate tears down the same owns a close does", () => {
		const native = new FakeNative();
		native.uiStatus = 5;
		const adapter = darwinBrowserAdapter(ports(native));
		adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(native.calls).toContain("view-release:100");
		expect(native.calls).toContain("unweb:400");
	});

	test("a window that closed prunes its surface rather than answering a stale title", () => {
		const native = new FakeNative();
		const p = ports(native);
		const adapter = darwinBrowserAdapter({ ...p, windowOpen: () => false });
		adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds, owner: "main" });
		expect(adapter.state("docs")).toMatchObject({ ok: false, code: "not-found" });
	});

	test("capture photographs the surface and names the real size", async () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		adapter.open({ label: "docs", url: "http://127.0.0.1:4321/", bounds });
		expect(await adapter.capture("docs")).toEqual({
			ok: true,
			width: 600,
			height: 420,
			scale: 2,
			png: "cG5n",
		});
		expect(await adapter.capture("gone")).toMatchObject({ ok: false, code: "not-found" });
	});

	test("external reports the opener's own answer", () => {
		const native = new FakeNative();
		const adapter = darwinBrowserAdapter(ports(native));
		expect(adapter.external("http://127.0.0.1:4321/popup")).toEqual({ opened: true });
		expect(adapter.external("http://127.0.0.1:4321/bad")).toEqual({
			opened: false,
			reason: "NSWorkspace refused",
		});
	});
});
