/**
 * Only the app's own document gets a `?window=<label>` identity appended. A
 * scheme-less `//host/path` (or its backslash twins) is authority-absolute: the
 * adapter's `new URL(url, base)` loads a foreign origin, so it must pass
 * through untouched like any other absolute URL.
 */

import { expect, test } from "bun:test";

import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

test("an authority-relative URL is handed through with no window label", () => {
	// Each string resolves to a foreign origin under `new URL(url, base)`.
	for (const url of [
		"//evil.example/x",
		"\\\\evil.example/x",
		"/\\evil.example/x",
		"\\/evil.example/x",
	]) {
		const adapter = fakeAdapter([]);
		expect(createWindowPlugin(adapter).commands.create({ label: "w", url })).toEqual({
			ok: true,
			label: "w",
			created: true,
		});
		expect(adapter.calls).toEqual([`create:w:-x-:-:${url}`]);
	}
});

test("a single leading backslash is only a path and keeps its label", () => {
	const adapter = fakeAdapter([]);
	createWindowPlugin(adapter).commands.create({ label: "w", url: "\\settings" });
	expect(adapter.calls).toEqual(["create:w:-x-:-:\\settings?window=w"]);
});

test("an ordinary relative URL still carries the label", () => {
	const adapter = fakeAdapter([]);
	createWindowPlugin(adapter).commands.create({ label: "w", url: "/settings?tab=1" });
	expect(adapter.calls).toEqual(["create:w:-x-:-:/settings?tab=1&window=w"]);
});
