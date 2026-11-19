/**
 * The identity in the URL: what a window is opened with, and what a request is read back as. The
 * two halves share one parser, so a label written by `windowUrl` is the label the bridge sees.
 */

import { describe, expect, test } from "bun:test";
import { windowUrl } from "@/app-loop.ts";
import type { WindowConfig } from "@/config";
import {
	asWindowLabel,
	WINDOW_PARAM,
	windowLabelFromSearch,
	withWindowLabel,
} from "./window-identity.ts";
import { withForcedWindowLabel, withoutWindowLabel } from "./window-query.ts";

describe("withWindowLabel", () => {
	test("appends the parameter to a document path", () => {
		expect(withWindowLabel("http://127.0.0.1:5000/", "main")).toBe(
			"http://127.0.0.1:5000/?window=main",
		);
	});

	test("keeps an existing query byte-exact rather than re-encoding it", () => {
		expect(withWindowLabel("http://h/?a=1%202&b", "main")).toBe(
			"http://h/?a=1%202&b&window=main",
		);
	});

	test("leaves a hash last", () => {
		expect(withWindowLabel("http://h/x#top", "main")).toBe("http://h/x?window=main#top");
	});

	test("a URL that already names its own window is returned untouched", () => {
		expect(withWindowLabel("http://h/?window=inspector", "main")).toBe(
			"http://h/?window=inspector",
		);
	});

	test("a relative path keeps its own path: the query never moves the document", () => {
		// The e2e case: `child/relative` resolves against `/spare/idle.html`, so it must
		// land on `/spare/child/relative` with the label, not on the base document.
		expect(withWindowLabel("child/relative", "relative")).toBe(
			"child/relative?window=relative",
		);
		expect(
			new URL(withWindowLabel("child/relative", "relative"), "http://h/spare/idle.html")
				.pathname,
		).toBe("/spare/child/relative");
	});

	test("a label is encoded, and reads back unchanged", () => {
		const url = withWindowLabel("/", "big window");
		expect(url).toBe("/?window=big%20window");
		expect(windowLabelFromSearch(url.slice(url.indexOf("?")))).toBe("big window");
	});
});

describe("an absolute URL carries no identity the page can choose", () => {
	test("withForcedWindowLabel replaces a page-chosen label, even encoded", () => {
		expect(withForcedWindowLabel("http://h/x?%77indow=admin&tab=1", "child")).toBe(
			"http://h/x?tab=1&window=child",
		);
	});

	test("withoutWindowLabel strips every label and keeps other pairs byte-exact", () => {
		expect(withoutWindowLabel("http://h/x?window=admin&a=1%202&%77indow=bot#top")).toBe(
			"http://h/x?a=1%202#top",
		);
	});

	test("stripping the only pair leaves no dangling question mark", () => {
		expect(withoutWindowLabel("http://h/x?window=admin#top")).toBe("http://h/x#top");
	});
});

describe("reading a label back", () => {
	test("a named window answers its label", () => {
		expect(windowLabelFromSearch("?window=main")).toBe("main");
		expect(windowLabelFromSearch("a=1&window=inspector")).toBe("inspector");
	});

	test("absent, blank or non-string is no identity at all", () => {
		expect(windowLabelFromSearch("")).toBeUndefined();
		expect(windowLabelFromSearch("?other=1")).toBeUndefined();
		expect(windowLabelFromSearch("?window=")).toBeUndefined();
		expect(windowLabelFromSearch("?window=%20")).toBeUndefined();
		expect(asWindowLabel(undefined)).toBeUndefined();
		expect(asWindowLabel(null)).toBeUndefined();
		expect(asWindowLabel(42)).toBeUndefined();
	});

	test("the parameter name is the one the client reads", () => {
		expect(WINDOW_PARAM).toBe("window");
	});
});

const MAIN: WindowConfig = { label: "main", width: 800, height: 600 };

describe("windowUrl", () => {
	test("a bridge-served window carries its label and its token", () => {
		expect(windowUrl(MAIN, undefined, { url: "http://127.0.0.1:5000/", token: "abc" })).toBe(
			"http://127.0.0.1:5000/?window=main&token=abc",
		);
	});

	test("a configured path and query survive the label", () => {
		const window: WindowConfig = { ...MAIN, url: "/notes?tab=1" };
		expect(windowUrl(window, undefined, { url: "http://127.0.0.1:5000", token: "abc" })).toBe(
			"http://127.0.0.1:5000/notes?tab=1&window=main&token=abc",
		);
	});

	test("a dev-server window carries it too, so the page can read its own URL", () => {
		expect(windowUrl(MAIN, "http://localhost:5173", undefined)).toBe(
			"http://localhost:5173?window=main",
		);
	});

	test("a URL that names its own window is left to the app", () => {
		const window: WindowConfig = { ...MAIN, url: "/?window=mine" };
		expect(windowUrl(window, undefined, { url: "http://127.0.0.1:5000", token: "abc" })).toBe(
			"http://127.0.0.1:5000/?window=mine&token=abc",
		);
	});

	test("no page URL is still a named error, not a relative URL", () => {
		expect(() => windowUrl(MAIN, undefined, undefined)).toThrow("no page URL");
	});
});
