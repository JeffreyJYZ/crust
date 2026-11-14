/**
 * `window.create`'s argument rules and its one optional native member.
 *
 * Both are refusal-side proofs: an invalid payload never reaches a platform, and
 * an adapter written before `create` existed still satisfies `WindowNative`
 * while answering honestly. The happy path is `window-create.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("window.create arguments", () => {
	test("arguments are validated, never coerced or clamped", () => {
		const adapter = fakeAdapter([]);
		const plugin = createWindowPlugin(adapter);
		const type = (value: unknown) => value as { label: string };

		expect(plugin.commands.create({} as { label: string })).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.create(type({ label: 7 }))).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.create(type({ label: "" }))).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.create(type({ label: "ok", title: 5 }))).toMatchObject({
			ok: false,
			code: "invalid-label",
			label: "ok",
		});

		for (const size of [0, -1, 12.5, Number.NaN, "900", null] as unknown[]) {
			expect(plugin.commands.create(type({ label: "ok", width: size }))).toMatchObject({
				ok: false,
				code: "invalid-size",
			});
			expect(plugin.commands.create(type({ label: "ok", height: size }))).toMatchObject({
				ok: false,
				code: "invalid-size",
			});
		}

		for (const url of ["", 42, null] as unknown[]) {
			expect(plugin.commands.create(type({ label: "ok", url }))).toMatchObject({
				ok: false,
				code: "invalid-url",
			});
		}

		// Nothing invalid was ever handed to the platform, so no partial window was
		// built and then reported as a success.
		expect(adapter.calls).toEqual([]);
	});

	/**
	 * An adapter written before this command still satisfies `WindowNative`; the
	 * answer says which member is missing rather than failing to compile or
	 * pretending a window exists.
	 */
	test("an adapter with no create answers unknown-adapter", () => {
		const plugin = createWindowPlugin({
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => ["main"],
			isOpen: () => true,
		});

		expect(plugin.commands.create({ label: "prefs" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
	});
});
