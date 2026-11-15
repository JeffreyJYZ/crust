/**
 * The chrome commands' refusal side: a bad payload never reaches the adapter, an unknown label is `unknown-window` whatever the value was, an adapter that predates the command answers `unknown-adapter`, and no adapter at all is `not-implemented`. Happy path in `window-chrome.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("invalid payloads", () => {
	test("an opacity outside 0–1 is refused, never clamped", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);
		const bad = (value: unknown) => value as never;

		for (const value of [-0.1, 1.5, 2, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null]) {
			expect(plugin.commands.setOpacity(bad({ label: "main", value }))).toMatchObject({
				ok: false,
				code: "invalid-value",
			});
		}
		expect(adapter.calls).toEqual([]);
	});

	test("an unknown cursor name is refused, and the pointer is left alone", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);
		const bad = (cursor: unknown) => ({ cursor }) as never;

		for (const cursor of ["hand", "", "POINTER", 3, null, undefined]) {
			expect(plugin.commands.setCursor(bad(cursor))).toMatchObject({
				ok: false,
				code: "invalid-value",
			});
		}
		expect(adapter.calls).toEqual([]);
		expect(adapter.pointer()).toEqual({ cursor: "default", visible: true });
	});

	test("a non-boolean flag is refused", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);
		const bad = (value: unknown) => value as never;

		for (const value of ["false", 0, 1, null, undefined]) {
			expect(plugin.commands.setDecorations(bad({ label: "main", value }))).toMatchObject({
				ok: false,
				code: "invalid-value",
			});
			expect(plugin.commands.setCursorVisible(bad({ value }))).toMatchObject({
				ok: false,
				code: "invalid-value",
			});
		}
		expect(adapter.calls).toEqual([]);
	});
});

describe("labels and adapters", () => {
	test("an unknown label answers unknown-window whatever the payload held", () => {
		const plugin = createWindowPlugin(fakeAdapter());

		expect(plugin.commands.setDecorations({ label: "ghost", value: true })).toMatchObject({
			ok: false,
			code: "unknown-window",
			label: "ghost",
		});
		expect(plugin.commands.isDecorated({ label: "ghost" })).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
		expect(plugin.commands.opacity({ label: "ghost" })).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
	});

	test("an adapter that predates the commands answers unknown-adapter", () => {
		const plugin = createWindowPlugin({
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => ["main"],
			isOpen: () => true,
		});

		expect(plugin.commands.isDecorated({ label: "main" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
		expect(plugin.commands.setCursor({ cursor: "pointer" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
		expect(plugin.commands.setCursorVisible({ value: false })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
	});

	test("no adapter at all is not-implemented, naming NSWindow", () => {
		const plugin = createWindowPlugin();
		expect(plugin.commands.opacity({ label: "main" })).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "NSWindow",
		});
		expect(plugin.commands.setCursor({ cursor: "pointer" })).toMatchObject({
			ok: false,
			code: "not-implemented",
		});
	});
});
