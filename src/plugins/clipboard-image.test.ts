/**
 * `crust:clipboard` image proofs that need no pasteboard: every case drives a fake adapter, so nothing here reads or writes the user's clipboard. The native unit is proven in `platform/darwin/clipboard.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	type ClipboardAdapter,
	type ClipboardWriteImageArgs,
	createClipboardPlugin,
} from "@/plugins/clipboard.ts";
import { isNotImplemented } from "@/plugins/define.ts";

/** The eight PNG magic bytes plus a payload; the plugin only reads the magic. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** An adapter that records the images it was asked to write. */
function fake(overrides: Partial<ClipboardAdapter> = {}): ClipboardAdapter & {
	images: Uint8Array[];
} {
	const images: Uint8Array[] = [];
	return {
		images,
		readText: () => "",
		writeText: () => "written",
		readImage: () => new Uint8Array(0),
		writeImage: (png) => {
			images.push(png);
			return "written";
		},
		...overrides,
	};
}

describe("clipboard readImage", () => {
	test("hands the pasteboard's PNG bytes through unchanged", async () => {
		const plugin = createClipboardPlugin(fake({ readImage: () => PNG }));
		expect(await plugin.commands.readImage()).toEqual({ ok: true, png: PNG });
	});

	test("zero bytes is an empty pasteboard, which is a null image", async () => {
		const plugin = createClipboardPlugin(fake());
		expect(await plugin.commands.readImage()).toEqual({ ok: true, png: null });
	});

	test("a native null is not-implemented, because there was no pasteboard", async () => {
		const plugin = createClipboardPlugin(fake({ readImage: () => null }));
		const answer = await plugin.commands.readImage();
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("NSPasteboard");
	});

	test("an adapter that throws answers a typed failure, never a throw", async () => {
		const plugin = createClipboardPlugin(
			fake({
				readImage: () => {
					throw new Error("NSImage is gone");
				},
			}),
		);
		expect(await plugin.commands.readImage()).toEqual({
			ok: false,
			code: "handler-error",
			message: "NSImage is gone",
		});
	});

	test("an adapter answering something other than bytes is refused", async () => {
		const plugin = createClipboardPlugin(fake({ readImage: () => "not bytes" as never }));
		expect(await plugin.commands.readImage()).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: clipboard adapter did not return image bytes",
		});
	});
});

describe("clipboard writeImage", () => {
	test("writes the exact PNG bytes the caller handed over", async () => {
		const adapter = fake();
		const plugin = createClipboardPlugin(adapter);
		expect(await plugin.commands.writeImage({ png: PNG })).toEqual({ ok: true, written: true });
		expect(adapter.images).toEqual([PNG]);
	});

	test("bare bytes are the same request as `{ png }`, because that is how the bridge sends them", async () => {
		const adapter = fake();
		const plugin = createClipboardPlugin(adapter);
		expect(await plugin.commands.writeImage(PNG)).toEqual({ ok: true, written: true });
		expect(adapter.images).toEqual([PNG]);
	});

	test("non-PNG bytes are refused by magic number, before the adapter is touched", async () => {
		const adapter = fake();
		const plugin = createClipboardPlugin(adapter);
		const payloads: unknown[] = [
			undefined,
			{},
			{ png: "89 50 4e 47" },
			{ png: new Uint8Array(0) },
			{ png: new Uint8Array([0x89, 0x50, 0x4e]) },
			{ png: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]) },
		];
		for (const payload of payloads) {
			const answer = await plugin.commands.writeImage(payload as ClipboardWriteImageArgs);
			expect(answer).toEqual({
				ok: false,
				code: "bad-request",
				message: 'clipboard.writeImage: "png" must be PNG bytes',
			});
		}
		expect(adapter.images).toEqual([]);
	});

	test("a refusal is write-failed and keeps the verdict", async () => {
		const adapter = fake({ writeImage: () => "refused" });
		const answer = await createClipboardPlugin(adapter).commands.writeImage({ png: PNG });
		expect(answer).toEqual({
			ok: false,
			code: "write-failed",
			message:
				"clipboard.writeImage: the general pasteboard did not take the image (refused)",
		});
	});

	test("a missing pasteboard is not-implemented, not a refusal", async () => {
		const adapter = fake({ writeImage: () => "missing" });
		const answer = await createClipboardPlugin(adapter).commands.writeImage({ png: PNG });
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("NSPasteboard");
	});
});
