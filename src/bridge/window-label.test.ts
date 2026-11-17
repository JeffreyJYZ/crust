/**
 * The proof the multi-window story needed: two windows on one bridge, each page answering its own
 * label, and a page with no identity refused by name.
 *
 * The identity is the document URL. The bridge reads `?window=<label>` off the document request and
 * injects it, the page client sends it on every invoke, and `window.label` answers the label the
 * request carried — so nothing here reads the adapter, and nothing guesses which window asked.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createWindowPlugin } from "@/plugins/window.ts";
import { WINDOW_LABEL_REQUIRES } from "@/plugins/window-label.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import { installPage } from "./client/fixtures.ts";
import type { BridgeHandle } from "./server.ts";
import { start, stopAll } from "./server/fixtures.ts";

afterEach(stopAll);

/** One bridge carrying the window plugin, with both labels open, so a refusal cannot be "no window". */
function windowBridge(): BridgeHandle {
	return start({ handlers: [createWindowPlugin(fakeAdapter(["main", "inspector"]))] });
}

/** The config the bridge injected into a document, which is what the page client installs from. */
function servedConfig(html: string): Record<string, unknown> {
	const match = /\{"baseUrl":"[^"]*","port":\d+(?:,"window":"[^"]*")?\}/.exec(html);
	if (!match) throw new Error("the document carried no injected config");
	return JSON.parse(match[0]) as Record<string, unknown>;
}

describe("the document carries the window", () => {
	test("each window's document names its own label", async () => {
		const bridge = windowBridge();
		expect(
			servedConfig(
				await (await fetch(`${bridge.url}/?window=main&token=${bridge.token}`)).text(),
			).window,
		).toBe("main");
		expect(
			servedConfig(
				await (await fetch(`${bridge.url}/?window=inspector&token=${bridge.token}`)).text(),
			).window,
		).toBe("inspector");
	});

	test("a document requested without one injects none", async () => {
		const bridge = windowBridge();
		const document = await (await fetch(`${bridge.url}/?token=${bridge.token}`)).text();
		expect(servedConfig(document).window).toBeUndefined();
	});
});

describe("two windows, one bridge", () => {
	test("each page answers its own label", async () => {
		const bridge = windowBridge();
		const main = servedConfig(
			await (await fetch(`${bridge.url}/?window=main&token=${bridge.token}`)).text(),
		);
		const inspector = servedConfig(
			await (await fetch(`${bridge.url}/?window=inspector&token=${bridge.token}`)).text(),
		);

		const mainPage = installPage(bridge, { config: main });
		const inspectorPage = installPage(bridge, { config: inspector });

		expect(await mainPage.api.invoke("window", "label")).toEqual({ ok: true, label: "main" });
		expect(await inspectorPage.api.invoke("window", "label")).toEqual({
			ok: true,
			label: "inspector",
		});
	});

	test("a dev-server page reads its label from its own URL", async () => {
		const bridge = windowBridge();
		const page = installPage(bridge, { source: "dev", search: "?window=inspector" });
		expect(await page.api.invoke("window", "label")).toEqual({ ok: true, label: "inspector" });
	});

	test("the label the bridge observed wins over one the page's URL now shows", async () => {
		const bridge = windowBridge();
		const page = installPage(bridge, {
			config: { window: "main" },
			search: "?window=inspector",
		});
		expect(await page.api.invoke("window", "label")).toEqual({ ok: true, label: "main" });
	});
});

describe("no identity", () => {
	test("a page with none is refused by name, never handed the first window", async () => {
		const bridge = windowBridge();
		const page = installPage(bridge, { source: "dev", search: "" });
		await expect(page.api.invoke("window", "label")).rejects.toMatchObject({
			code: "not-implemented",
			requires: WINDOW_LABEL_REQUIRES,
			message: expect.stringContaining("no window identity"),
		});
	});
});
