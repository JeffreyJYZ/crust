/**
 * The Linux adapter with its platform calls faked, so the create/place/load ordering and the two
 * policies' plumbing are provable without GTK. The real GTK calls are proved by the new smoke step
 * in `scripts/linux/proof-browser.ts` on the ubuntu runner.
 */
import { describe, expect, test } from "bun:test";
import type { BrowserBounds } from "@/plugins/browser";
import { linuxBrowserAdapter } from "./browser";
import { FakePorts, STATE } from "./browser-fake";

const BOUNDS: BrowserBounds = { x: 10, y: 20, width: 640, height: 400 };

describe("linuxBrowserAdapter", () => {
	test("open creates the view, places it, loads it and installs both policies", () => {
		const fake = new FakePorts();
		const adapter = linuxBrowserAdapter(fake);
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
			"new",
			"place:250:400:10,20,640,400",
			`load:400:${STATE.url}`,
			"watch:400",
			"deny:400",
			"sink:set",
		]);
	});

	test("a refused signal handler removes the view instead of leaving an unguarded surface", () => {
		const fake = new FakePorts();
		fake.signalsRefused = true;
		const adapter = linuxBrowserAdapter(fake);
		expect(adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
		expect(fake.calls).toContain("close:400");
	});

	test("a failed load names the URL and destroys the view", () => {
		const fake = new FakePorts();
		const adapter = linuxBrowserAdapter(fake);
		expect(
			adapter.open({
				label: "docs",
				url: `${STATE.url}refuse`,
				bounds: BOUNDS,
			}),
		).toMatchObject({ ok: false, code: "handler-error" });
		expect(fake.calls).toContain("close:400");
	});

	test("a duplicate label is refused before a second view exists", () => {
		const fake = new FakePorts();
		const adapter = linuxBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		const before = fake.calls.length;
		expect(adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS })).toMatchObject({
			ok: false,
			code: "bad-request",
		});
		expect(fake.calls.length).toBe(before);
	});

	test("state reads the view, setBounds re-places it, close ends it", () => {
		const fake = new FakePorts();
		const adapter = linuxBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		expect(adapter.state("docs")).toMatchObject({
			ok: true,
			title: "Remote Title",
		});
		const moved = { x: 1, y: 2, width: 3, height: 4 };
		expect(adapter.setBounds("docs", moved)).toEqual({ ok: true });
		expect(fake.calls).toContain("place:250:400:1,2,3,4");
		expect(adapter.navigate("docs", STATE.url)).toMatchObject({
			ok: true,
			loaded: true,
		});
		expect(adapter.close("docs")).toEqual({ ok: true, closed: true });
		expect(fake.calls).toContain("close:400");
		expect(adapter.state("docs")).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("a window that closed prunes its surface rather than answering a stale title", () => {
		const fake = new FakePorts();
		fake.windowOpen = () => false;
		const adapter = linuxBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		expect(adapter.state("docs")).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("capture is refused by name: get_snapshot answers a cairo surface", async () => {
		const fake = new FakePorts();
		const adapter = linuxBrowserAdapter(fake);
		adapter.open({ label: "docs", url: STATE.url, bounds: BOUNDS });
		expect(await adapter.capture("docs")).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "webkit_web_view_get_snapshot",
		});
		expect(await adapter.capture("gone")).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("external reports the opener's own answer", () => {
		const fake = new FakePorts();
		const adapter = linuxBrowserAdapter(fake);
		expect(adapter.external(`${STATE.url}popup`)).toEqual({ opened: true });
		expect(adapter.external(`${STATE.url}bad`)).toEqual({
			opened: false,
			reason: "gio refused",
		});
	});
});
