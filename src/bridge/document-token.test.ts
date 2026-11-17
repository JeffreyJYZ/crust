/**
 * The document token: the credential travels on the navigation URL, not in the HTML.
 *
 * `20-security.md` finding 1 — any local process could `GET /` and read the bearer token out of the
 * inline bootstrap. The fix is a contract between four pieces, so each is proved here:
 * `windowUrl` puts `?token=` on the URL, the document route requires it, the page reads it back out
 * of `location.search`, and `window.create` does the same for a runtime-opened window.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { windowUrl } from "@/app-loop.ts";
import { bootstrapSource } from "@/bridge/client.ts";
import { createWindowPlugin } from "@/plugins/window.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import type { WindowConfig } from "@/config";
import {
	currentBridgeToken,
	setBridgeToken,
	tokenFromSearch,
	withToken,
} from "./window-identity.ts";
import { start, stopAll, testPlugin } from "./server/fixtures.ts";

afterEach(stopAll);

const MAIN: WindowConfig = { label: "main", width: 800, height: 600 };

describe("withToken", () => {
	test("appends the parameter to a document URL", () => {
		expect(withToken("http://h:1/", "abc")).toBe("http://h:1/?token=abc");
	});

	test("keeps an existing query and puts the hash last", () => {
		expect(withToken("http://h/x?tab=1#top", "abc")).toBe("http://h/x?tab=1&token=abc#top");
	});

	test("replaces a stale token rather than shadowing the live one", () => {
		expect(withToken("http://h/?token=old&a=1", "new")).toBe("http://h/?a=1&token=new");
	});

	test("a relative reference stays relative", () => {
		expect(withToken("child/page", "abc")).toBe("child/page?token=abc");
	});
});

describe("tokenFromSearch", () => {
	test("reads the parameter, with or without the question mark", () => {
		expect(tokenFromSearch("?token=abc")).toBe("abc");
		expect(tokenFromSearch("a=1&token=abc")).toBe("abc");
	});

	test("absent or blank is no token at all", () => {
		expect(tokenFromSearch("")).toBeUndefined();
		expect(tokenFromSearch("?token=")).toBeUndefined();
		expect(tokenFromSearch("?token=%20")).toBeUndefined();
	});
});

describe("windowUrl carries the credential", () => {
	test("a bridge-served window gets both its label and the token", () => {
		expect(windowUrl(MAIN, undefined, { url: "http://127.0.0.1:5000/", token: "abc" })).toBe(
			"http://127.0.0.1:5000/?window=main&token=abc",
		);
	});

	test("a configured path and query survive both parameters", () => {
		const window: WindowConfig = { ...MAIN, url: "/notes?tab=1" };
		expect(windowUrl(window, undefined, { url: "http://127.0.0.1:5000", token: "abc" })).toBe(
			"http://127.0.0.1:5000/notes?tab=1&window=main&token=abc",
		);
	});

	test("a dev-server window carries no token: Vite serves it, not the bridge", () => {
		expect(windowUrl(MAIN, "http://localhost:5173", { url: "http://h:1/", token: "abc" })).toBe(
			"http://localhost:5173?window=main",
		);
	});

	test("a recorded label is still the app's to define", () => {
		const window: WindowConfig = { ...MAIN, url: "/?window=mine" };
		expect(windowUrl(window, undefined, { url: "http://127.0.0.1:5000", token: "abc" })).toBe(
			"http://127.0.0.1:5000/?window=mine&token=abc",
		);
	});
});

describe("the page reads its own token", () => {
	test("the injected config names no token and the snippet reads the URL", () => {
		const snippet = bootstrapSource({ baseUrl: "", port: 1 });
		expect(snippet).toContain('get("token")');
		expect(snippet).not.toContain('"token":"');
	});

	test("a served page's HTML never holds the bridge token", async () => {
		const bridge = start({
			handlers: [testPlugin],
			indexHtml: "<html><head></head><body></body></html>",
		});
		const html = await (await fetch(`${bridge.url}/?token=${bridge.token}`)).text();
		expect(html).toContain("baseUrl");
		expect(html).not.toContain(bridge.token);
	});
});

describe("window.create carries the token", () => {
	test("a recorded bridge token rides on the new window's own document", () => {
		setBridgeToken("tok-1");
		try {
			const adapter = fakeAdapter([]);
			const plugin = createWindowPlugin(adapter);
			plugin.commands.create({ label: "prefs" });
			expect(adapter.calls).toEqual(["create:prefs:-x-:-:/?window=prefs&token=tok-1"]);
			expect(currentBridgeToken()).toBe("tok-1");
		} finally {
			setBridgeToken(undefined);
		}
	});

	test("with no bridge yet the URL stays exactly as it was", () => {
		setBridgeToken(undefined);
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({ label: "prefs" });
		expect(adapter.calls).toEqual(["create:prefs:-x-:-:/?window=prefs"]);
	});
});
