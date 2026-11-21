/**
 * Two regressions in one seam: a repeat used to re-run one process-wide query on whichever window
 * the command named, and an older completion used to settle a newer search. Both are proved here
 * with a recording native and no WebKit — the ids and the per-webview text never leave JS.
 */
import { toArrayBuffer } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { FIND_STATUS, type FindNative } from "./find-unit.ts";
import { darwinFindAdapter, deliverFind } from "./find.ts";
import { MAIN, PREFS, twoWindows } from "./webview-target-fixture.ts";
import { webviewResolver } from "./webview-target.ts";

interface Search {
	web: number;
	text: string;
	backwards: number;
	id: number;
}

function recorder(): { native: FindNative; searches: Search[] } {
	const searches: Search[] = [];
	const native: FindNative = {
		crust_find_set_sink: () => {},
		crust_find_available: () => 1,
		crust_find_search: (web, bytes, length, backwards, _case, id) => {
			searches.push({
				web,
				text: Buffer.from(toArrayBuffer(bytes, 0, length)).toString(),
				backwards,
				id,
			});
			// Refuse immediately: this suite proves what was sent, not WebKit's answer.
			return FIND_STATUS.unavailable;
		},
		crust_find_repeat: () => FIND_STATUS.unavailable,
		crust_find_block_ready: () => 1,
	};
	return { native, searches };
}

describe("find-in-page query ownership", () => {
	test("next in one window repeats that window's search, not the other window's", async () => {
		const { native, searches } = recorder();
		const adapter = darwinFindAdapter(webviewResolver(twoWindows()), native);
		await expect(
			adapter.search({ text: "alpha", forward: true, matchCase: false }, "main"),
		).rejects.toThrow();
		await expect(
			adapter.search({ text: "beta", forward: true, matchCase: false }, "prefs"),
		).rejects.toThrow();
		await expect(adapter.next("main")).rejects.toThrow();
		expect(searches.map((entry) => entry.web)).toEqual([MAIN, PREFS, MAIN]);
		expect(searches.map((entry) => entry.text)).toEqual(["alpha", "beta", "alpha"]);
	});

	test("a window that never searched refuses next rather than borrowing text", () => {
		const { native, searches } = recorder();
		const adapter = darwinFindAdapter(webviewResolver(twoWindows()), native);
		expect(() => adapter.next("prefs")).toThrow("needs a search in this window");
		expect(searches).toEqual([]);
	});

	test("a completion for an older request cannot settle the newer search", async () => {
		const { native, searches } = recorder();
		// Let the search actually start so there is a promise for the completion to settle.
		native.crust_find_search = (_web, _bytes, _length, _backwards, _case, id) => {
			searches.push({ web: MAIN, text: "x", backwards: 0, id });
			queueMicrotask(() => deliverFind(id, 1));
			return FIND_STATUS.started;
		};
		const adapter = darwinFindAdapter(webviewResolver(twoWindows()), native);
		const first = adapter.search({ text: "alpha", forward: true, matchCase: false }, "main");
		const second = adapter.search({ text: "beta", forward: true, matchCase: false }, "main");
		await expect(first).rejects.toThrow("superseded this one");
		// Both WebKit renders complete. Only the second request's id matches the live promise, and
		// even if the stale completion lands last, the answer must carry the newer search's id.
		deliverFind(searches[0]?.id ?? -1, 1);
		await expect(second).resolves.toEqual({ matches: 1, found: true });
		expect(searches[1]?.id).not.toBe(searches[0]?.id);
	});
});
