/**
 * `window.capture` through the plugin, on the fake adapter: the shape reaches the page, and every
 * way a platform can say no is a typed answer rather than a resolved fake. The one thing this
 * suite cannot prove is a real picture — that is `snapshot-unit.test.ts` and the darwin e2e, which
 * run WebKit.
 */

import { describe, expect, test } from "bun:test";
import { WINDOW_CAPTURE_REQUIRES } from "./window-capture.ts";
import { FAKE_CAPTURE_PNG, fakeAdapter } from "./window-fake.ts";
import { WindowAdapterError, createWindowPlugin } from "./window.ts";

describe("window.capture", () => {
	test("answers the page's picture: label, pixel size, scale and base64 PNG", async () => {
		const adapter = fakeAdapter(["main", "prefs"]);
		const plugin = createWindowPlugin(adapter);

		const answer = await plugin.commands.capture({ label: "prefs" });
		expect(answer).toEqual({
			ok: true,
			label: "prefs",
			width: 1,
			height: 1,
			scale: 1,
			png: FAKE_CAPTURE_PNG,
		});
		// The label crossed, so a multi-window app captures the window it named.
		expect(adapter.calls).toEqual(["capture:prefs"]);
		// base64 of a PNG, not a `data:` URL: a caller decodes it or writes it as a file.
		expect(Buffer.from(FAKE_CAPTURE_PNG, "base64").subarray(0, 4)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47]),
		);
	});

	test("a label this platform does not track is unknown-window, never another window", async () => {
		const plugin = createWindowPlugin(fakeAdapter(["main"]));

		expect(await plugin.commands.capture({ label: "ghost" })).toMatchObject({
			ok: false,
			code: "unknown-window",
			label: "ghost",
		});
	});

	test("a payload with no label is refused by name", async () => {
		const plugin = createWindowPlugin(fakeAdapter());

		expect(await plugin.commands.capture({} as { label: string })).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
	});

	test("no adapter answers not-implemented and names the API it would need", async () => {
		const answer = await createWindowPlugin().commands.capture({ label: "main" });

		expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
		if (answer.ok !== false || answer.code !== "not-implemented")
			throw new Error("unreachable");
		expect(answer.requires).toBe(WINDOW_CAPTURE_REQUIRES);
		expect(answer.requires).toContain("takeSnapshotWithConfiguration:completionHandler:");
	});

	test("an adapter without the member is a platform that cannot capture, not a stale adapter", async () => {
		const adapter = fakeAdapter();
		const bare = { ...adapter, capture: undefined };
		const plugin = createWindowPlugin(bare);

		const answer = await plugin.commands.capture({ label: "main" });
		expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
		if (answer.ok !== false || answer.code !== "not-implemented")
			throw new Error("unreachable");
		expect(answer.requires).toBe(WINDOW_CAPTURE_REQUIRES);
	});

	test("a platform refusal reaches the page as its own code", async () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin({
			...adapter,
			capture: async () => {
				throw new WindowAdapterError("handler-error", "crust: WebKit answered no image");
			},
		});

		expect(await plugin.commands.capture({ label: "main" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: WebKit answered no image",
			label: "main",
		});
	});

	test("both probe options reach the adapter without coercion", async () => {
		const adapter = fakeAdapter(["main"]);
		let seen: unknown;
		const plugin = createWindowPlugin({
			...adapter,
			capture: async (label, options) => {
				seen = options;
				return adapter.capture!(label);
			},
		});

		expect(
			await plugin.commands.capture({ label: "main", ignoreOcclusion: true, prime: false }),
		).toMatchObject({ ok: true, label: "main" });
		expect(seen).toEqual({ ignoreOcclusion: true, prime: false });
	});

	test("a non-boolean prime is invalid-value, never coerced into an opt-in", async () => {
		const plugin = createWindowPlugin(fakeAdapter(["main"]));

		expect(
			await plugin.commands.capture({ label: "main", prime: "true" } as never),
		).toMatchObject({
			ok: false,
			code: "invalid-value",
			message: expect.stringContaining("window.capture prime must be a boolean"),
		});
	});

	test("an adapter that answers no png is a handler-error, not a broken picture", async () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin({
			...adapter,
			capture: async () => ({ width: 10, height: 10, scale: 1, png: "" }),
		});

		expect(await plugin.commands.capture({ label: "main" })).toMatchObject({
			ok: false,
			code: "handler-error",
			label: "main",
		});
	});

	// The state measured in the fullscreen probe: WebKit answered, but the view had never
	// composited, so the PNG is one flat colour. Pixels alone cannot say that — a visible page
	// that draws one flat colour looks identical — so the platform facts travel with the picture.
	const flatFromNeverComposited = {
		width: 960,
		height: 640,
		scale: 2,
		png: FAKE_CAPTURE_PNG,
		flat: true,
		composited: false,
	};

	test("a flat picture from a view that never composited is no-picture, not ok", async () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin({
			...adapter,
			capture: async () => flatFromNeverComposited,
		});

		const answer = await plugin.commands.capture({ label: "main" });
		expect(answer).toMatchObject({
			ok: false,
			code: "no-picture",
			label: "main",
		});
		if (answer.ok !== false || answer.code !== "no-picture") throw new Error("unreachable");
		expect(answer.message).toContain("answered the snapshot with no image");
	});

	test("one flat colour from a composited page is still a picture", async () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin({
			...adapter,
			capture: async () => ({ ...flatFromNeverComposited, composited: true }),
		});

		expect(await plugin.commands.capture({ label: "main" })).toMatchObject({
			ok: true,
			label: "main",
			png: FAKE_CAPTURE_PNG,
		});
	});

	test("a platform that reports no composited fact is not refused on pixels alone", async () => {
		const adapter = fakeAdapter();
		const { composited: _unreported, ...withoutFact } = flatFromNeverComposited;
		const plugin = createWindowPlugin({
			...adapter,
			capture: async () => withoutFact,
		});

		expect(await plugin.commands.capture({ label: "main" })).toMatchObject({
			ok: true,
			label: "main",
		});
	});
});
