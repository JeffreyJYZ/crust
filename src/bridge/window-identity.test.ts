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

	test("an empty base is a query-only reference: this document, with a label", () => {
		expect(withWindowLabel("", "prefs")).toBe("?window=prefs");
	});

	test("a label is encoded, and reads back unchanged", () => {
		const url = withWindowLabel("/", "big window");
		expect(url).toBe("/?window=big%20window");
		expect(windowLabelFromSearch(url.slice(url.indexOf("?")))).toBe("big window");
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
	test("a bridge-served window carries its label", () => {
		expect(windowUrl(MAIN, undefined, "http://127.0.0.1:5000/")).toBe(
			"http://127.0.0.1:5000/?window=main",
		);
	});

	test("a configured path and query survive the label", () => {
		const window: WindowConfig = { ...MAIN, url: "/notes?tab=1" };
		expect(windowUrl(window, undefined, "http://127.0.0.1:5000")).toBe(
			"http://127.0.0.1:5000/notes?tab=1&window=main",
		);
	});

	test("a dev-server window carries it too, so the page can read its own URL", () => {
		expect(windowUrl(MAIN, "http://localhost:5173", undefined)).toBe(
			"http://localhost:5173?window=main",
		);
	});

	test("a URL that names its own window is left to the app", () => {
		const window: WindowConfig = { ...MAIN, url: "/?window=mine" };
		expect(windowUrl(window, undefined, "http://127.0.0.1:5000")).toBe(
			"http://127.0.0.1:5000/?window=mine",
		);
	});

	test("no page URL is still a named error, not a relative URL", () => {
		expect(() => windowUrl(MAIN, undefined, undefined)).toThrow("no page URL");
	});
});
