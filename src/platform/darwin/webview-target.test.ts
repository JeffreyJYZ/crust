/**
 * Two fake windows, and the one defect this proves fixed: navigation, find-in-page and downloads
 * each acted on the app's first window whatever a caller meant, because the resolver was built
 * from `windowLabels()[0]` alone. Every assertion here names a window and checks which pointer
 * the native half actually received; the fakes in `webview-target-fixture.ts` record it, so
 * nothing is compiled and no window is created.
 */

import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors";
import { darwinDownloadsAdapter } from "./downloads.ts";
import { darwinFindAdapter } from "./find.ts";
import { darwinNavigationAdapter } from "./navigation.ts";
import {
	fakeDownloads,
	fakeFind,
	fakeNavigation,
	MAIN,
	PREFS,
	thrown,
	twoWindows,
} from "./webview-target-fixture.ts";
import { webviewResolver } from "./webview-target.ts";

describe("a labelled webview", () => {
	test("no label is the first open window, and a label reaches its own", () => {
		const webviewFor = webviewResolver(twoWindows());
		expect(webviewFor()).toBe(MAIN);
		expect(webviewFor("main")).toBe(MAIN);
		expect(webviewFor("prefs")).toBe(PREFS);
	});

	test("an unknown label is refused by name, never answered with the first window", () => {
		const webviewFor = webviewResolver(twoWindows());
		const error = thrown(() => webviewFor("nope"));
		expect(error).toBeInstanceOf(CrustError);
		expect((error as CrustError).code).toBe("bad-request");
		expect((error as Error).message).toContain('"nope"');
	});

	test("a window with no webview is null, and so is an app with no windows", () => {
		const empty = webviewResolver({ windowLabels: () => [], webview: () => undefined });
		expect(empty()).toBeNull();
		const bare = webviewResolver({ windowLabels: () => ["main"], webview: () => undefined });
		expect(bare()).toBeNull();
	});
});

describe("navigation reaches the window it was asked for", () => {
	test("start, reload and goBack each name their own window", () => {
		const { seen, symbols } = fakeNavigation();
		const adapter = darwinNavigationAdapter(webviewResolver(twoWindows()), symbols);

		expect(adapter.start(() => {}, "prefs").ok).toBe(true);
		expect(seen).toEqual([PREFS]);
		expect(adapter.reload("main")).toBe(true);
		expect(adapter.goBack("prefs")).toBe(true);
		// No label still means the first open window, which is what a single-window app means.
		expect(adapter.reload()).toBe(true);
		expect(seen).toEqual([PREFS, MAIN, PREFS, MAIN]);
	});

	test("an unknown label is a bad request and touches no webview", () => {
		const { seen, symbols } = fakeNavigation();
		const adapter = darwinNavigationAdapter(webviewResolver(twoWindows()), symbols);
		const error = thrown(() => adapter.state("nope"));
		expect((error as CrustError).code).toBe("bad-request");
		expect(seen).toEqual([]);
	});
});

describe("find-in-page reaches the window it was asked for", () => {
	test("search, next and previous each name their own window", async () => {
		const { seen, symbols } = fakeFind();
		const adapter = darwinFindAdapter(webviewResolver(twoWindows()), symbols);

		await expect(
			adapter.search({ text: "crust", forward: true, matchCase: false }, "prefs"),
		).rejects.toThrow();
		await expect(adapter.next("main")).rejects.toThrow();
		await expect(adapter.previous()).rejects.toThrow();
		expect(seen).toEqual([PREFS, MAIN, MAIN]);
	});

	test("an unknown label is a bad request and searches nothing", () => {
		const { seen, symbols } = fakeFind();
		const adapter = darwinFindAdapter(webviewResolver(twoWindows()), symbols);
		const error = thrown(() =>
			adapter.search({ text: "crust", forward: true, matchCase: false }, "nope"),
		);
		expect((error as CrustError).code).toBe("bad-request");
		expect((error as Error).message).toContain('"nope"');
		expect(seen).toEqual([]);
	});
});

describe("downloads reach the window they were asked for", () => {
	test("start names its own window, and no label means the first", () => {
		const { seen, unit } = fakeDownloads();
		const adapter = darwinDownloadsAdapter(
			{ webview: webviewResolver(twoWindows()) },
			() => unit,
		);

		expect(adapter.start("https://example.com/a.txt", "dl-1", "prefs")).toBe(true);
		expect(adapter.start("https://example.com/b.txt", "dl-2")).toBe(true);
		expect(seen).toEqual([PREFS, MAIN]);
	});

	test("an unknown label is a bad request and starts nothing", () => {
		const { seen, unit } = fakeDownloads();
		const adapter = darwinDownloadsAdapter(
			{ webview: webviewResolver(twoWindows()) },
			() => unit,
		);
		const error = thrown(() => adapter.start("https://example.com/a.txt", "dl-1", "nope"));
		expect((error as CrustError).code).toBe("bad-request");
		expect(seen).toEqual([]);
	});
});
