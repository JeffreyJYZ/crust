/**
 * The token moved out of the served HTML and onto the navigation URL, which makes "an absolute URL
 * passes through untouched" incomplete: a page that builds `location.origin + "/spare/x"` is naming
 * its own bridge, and the document route answers `401` without the credential. A foreign origin still
 * passes through untouched. A bridge-owned URL gets the seed token and the native label from the
 * command: any `?window=` the page put there is replaced so it cannot mint a document for a label the
 * page chose, while leaving it absent would fall back to main's grants.
 */
import { expect, test } from "bun:test";
import { setBridgeToken } from "@/bridge/window-identity.ts";
import { start, stopAll, testPlugin } from "@/bridge/server/fixtures.ts";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

const ORIGIN = "http://127.0.0.1:4123";

test("an absolute URL on the bridge gets the token and the command's label", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({
			label: "w",
			url: `${ORIGIN}/spare/child/x`,
		});
		expect(adapter.calls).toEqual([
			`create:w:-x-:-:${ORIGIN}/spare/child/x?window=w&token=tok-1`,
		]);
	} finally {
		setBridgeToken(undefined);
	}
});

test("a foreign origin never receives the token", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({
			label: "w",
			url: "https://example.com/docs",
		});
		expect(adapter.calls).toEqual(["create:w:-x-:-:https://example.com/docs"]);
	} finally {
		setBridgeToken(undefined);
	}
});

test("a relative URL keeps its label and gains the token", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({ label: "w", url: "/settings?tab=1" });
		expect(adapter.calls).toEqual(["create:w:-x-:-:/settings?tab=1&window=w&token=tok-1"]);
	} finally {
		setBridgeToken(undefined);
	}
});

test("a bridge-owned URL cannot carry a page-chosen window label", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({
			label: "child",
			url: `${ORIGIN}/spare/x?window=admin`,
		});
		// The page put `?window=admin` on an absolute URL. The command's own label replaces it, so
		// the seed token cannot mint a document bound to a label the page picked.
		expect(adapter.calls).toEqual([
			`create:child:-x-:-:${ORIGIN}/spare/x?window=child&token=tok-1`,
		]);
	} finally {
		setBridgeToken(undefined);
	}
});

test("a page-chosen window label cannot hide behind an encoded key", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({
			label: "child",
			url: `${ORIGIN}/spare/x?%77indow=admin&tab=1`,
		});
		expect(adapter.calls).toEqual([
			`create:child:-x-:-:${ORIGIN}/spare/x?tab=1&window=child&token=tok-1`,
		]);
	} finally {
		setBridgeToken(undefined);
	}
});

test("a relative URL cannot carry a page-chosen window label either", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({ label: "child", url: "/x?window=admin" });
		expect(adapter.calls).toEqual(["create:child:-x-:-:/x?window=child&token=tok-1"]);
	} finally {
		setBridgeToken(undefined);
	}
});

test("an encoded stale token cannot shadow the seed on a bridge-owned URL", async () => {
	const adapter = fakeAdapter([]);
	const bridge = start({
		handlers: [testPlugin, createWindowPlugin(adapter)],
		indexHtml: "<html></html>",
	});
	setBridgeToken(bridge.token, bridge.url);
	try {
		createWindowPlugin(adapter).commands.create({
			label: "child",
			url: `${bridge.url}/child?%74oken=dead`,
		});
		const call = adapter.calls.find((entry) => entry.startsWith("create:child:"));
		if (call === undefined) throw new Error("no window was created");
		const childUrl = call.slice(call.indexOf(":-x-:-:") + ":-x-:-:".length);
		// The document route reads the first decoded `token`, so a stale `%74oken` that survived
		// composition would answer 401 here instead of the app page.
		const served = await fetch(childUrl);
		expect(served.status).toBe(200);
	} finally {
		setBridgeToken(undefined);
		await stopAll();
	}
});

test("with no bridge started nothing is appended, which is the dev case", () => {
	setBridgeToken(undefined);
	const adapter = fakeAdapter([]);
	createWindowPlugin(adapter).commands.create({ label: "w", url: "/settings" });
	expect(adapter.calls).toEqual(["create:w:-x-:-:/settings?window=w"]);
});
