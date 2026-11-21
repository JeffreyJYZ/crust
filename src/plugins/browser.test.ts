/**
 * `crust:browser`, driven through a fake adapter. The rules worth proving without a window are the
 * two gates (a scheme gate and an origin allow list), the refusal shapes a page can act on, and the
 * geometry/state reads. The popup policy has its own file.
 */
import { describe, expect, test } from "bun:test";
import { createBrowserPlugin } from "@/plugins/browser";
import { ALLOWED, BOUNDS, collector, FakeBrowser } from "@/plugins/browser-fake";

describe("browser.open", () => {
	test("an origin outside the allow list is refused by name, before any native open", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin({ origins: ["https://example.com"] }, fake);
		const answer = plugin.commands.open(
			{ label: "docs", url: "https://evil.test/x", bounds: BOUNDS },
			collector().ctx,
		);
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
		expect((answer as { message: string }).message).toContain("origin https://evil.test");
		expect(fake.opened).toEqual([]);
	});

	test("a non-http scheme is refused, so file: and data: never become a load", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin({ origins: [ALLOWED] }, fake);
		const answer = plugin.commands.open(
			{ label: "docs", url: "file:///etc/passwd", bounds: BOUNDS },
			collector().ctx,
		);
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
		expect((answer as { message: string }).message).toContain("http(s)");
		expect(fake.opened).toEqual([]);
	});

	test("an allowed origin opens and the label comes back", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin({ origins: [ALLOWED] }, fake);
		expect(
			plugin.commands.open(
				{ label: "docs", url: `${ALLOWED}/page`, bounds: BOUNDS },
				collector().ctx,
			),
		).toEqual({ ok: true, label: "docs" });
		expect(fake.opened[0]?.bounds).toEqual(BOUNDS);
	});

	test("absolutely no section still registers and refuses every origin", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin(undefined, fake);
		const answer = plugin.commands.open(
			{ label: "docs", url: `${ALLOWED}/`, bounds: BOUNDS },
			collector().ctx,
		);
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
		expect((answer as { message: string }).message).toContain("allowed: none");
	});

	test("bad arguments are the caller's error and name the argument", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin({ origins: [ALLOWED] }, fake);
		expect(
			plugin.commands.open({ url: `${ALLOWED}/`, bounds: BOUNDS }, collector().ctx),
		).toMatchObject({
			ok: false,
			code: "bad-request",
		});
		expect(
			plugin.commands.open(
				{ label: "docs", url: `${ALLOWED}/`, bounds: { width: 0, height: 10 } },
				collector().ctx,
			),
		).toMatchObject({ ok: false, code: "bad-request" });
	});

	test("without an adapter every command answers not-implemented naming WKWebView", async () => {
		const plugin = createBrowserPlugin({ origins: [ALLOWED] });
		const answers = [
			plugin.commands.navigate({ label: "docs", url: ALLOWED }, collector().ctx),
			plugin.commands.state({ label: "docs" }, collector().ctx),
			plugin.commands.setBounds({ label: "docs", bounds: BOUNDS }, collector().ctx),
			plugin.commands.close({ label: "docs" }, collector().ctx),
			await plugin.commands.capture({ label: "docs" }, collector().ctx),
		];
		for (const answer of answers) {
			expect(answer).toMatchObject({
				ok: false,
				code: "not-implemented",
				requires: "WKWebView",
			});
		}
	});
});

describe("browser state and geometry", () => {
	test("state reads through, and an unknown surface is not-found", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin({ origins: [ALLOWED] }, fake);
		plugin.commands.open(
			{ label: "docs", url: `${ALLOWED}/`, bounds: BOUNDS },
			collector().ctx,
		);
		expect(plugin.commands.state({ label: "docs" }, collector().ctx)).toMatchObject({
			ok: true,
			title: "Remote Title",
		});
		expect(plugin.commands.state({ label: "gone" }, collector().ctx)).toMatchObject({
			ok: false,
			code: "not-found",
		});
	});

	test("setBounds moves the rectangle, capture renders the surface, close ends it", async () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin({ origins: [ALLOWED] }, fake);
		plugin.commands.open(
			{ label: "docs", url: `${ALLOWED}/`, bounds: BOUNDS },
			collector().ctx,
		);
		const moved = { x: 120, y: 260, width: 320, height: 220 };
		expect(
			plugin.commands.setBounds({ label: "docs", bounds: moved }, collector().ctx),
		).toEqual({
			ok: true,
		});
		expect(fake.frames[0]).toEqual({ label: "docs", bounds: moved });
		expect(await plugin.commands.capture({ label: "docs" }, collector().ctx)).toMatchObject({
			ok: true,
			width: 600,
			height: 420,
		});
		expect(plugin.commands.close({ label: "docs" }, collector().ctx)).toEqual({
			ok: true,
			closed: true,
		});
		expect(fake.closed).toEqual(["docs"]);
	});
});
