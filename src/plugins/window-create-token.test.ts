/**
 * The token moved out of the served HTML and onto the navigation URL, which makes "an absolute URL
 * passes through untouched" incomplete: a page that builds `location.origin + "/spare/x"` is naming
 * its own bridge, and the document route answers `401` without the credential. The rule that
 * replaced it is narrower — a foreign origin passes through untouched, this origin gets the token
 * and *not* a window label, because the app composed that URL itself.
 */
import { expect, test } from "bun:test";
import { setBridgeToken } from "@/bridge/window-identity.ts";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

const ORIGIN = "http://127.0.0.1:4123";

test("an absolute URL on the bridge gets the token and no label of its own", () => {
	setBridgeToken("tok-1", ORIGIN);
	try {
		const adapter = fakeAdapter([]);
		createWindowPlugin(adapter).commands.create({
			label: "w",
			url: `${ORIGIN}/spare/child/x`,
		});
		expect(adapter.calls).toEqual([`create:w:-x-:-:${ORIGIN}/spare/child/x?token=tok-1`]);
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

test("with no bridge started nothing is appended, which is the dev case", () => {
	setBridgeToken(undefined);
	const adapter = fakeAdapter([]);
	createWindowPlugin(adapter).commands.create({ label: "w", url: "/settings" });
	expect(adapter.calls).toEqual(["create:w:-x-:-:/settings?window=w"]);
});
