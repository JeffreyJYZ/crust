/**
 * `crust:clipboard` text proofs that need no pasteboard: every case drives a fake adapter, so nothing here reads or writes the user's clipboard. The image commands are proven in `clipboard-image.test.ts` and the native unit in `platform/darwin/clipboard.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	clipboardPlugin,
	type ClipboardAdapter,
	type ClipboardFailure,
	type ClipboardWriteArgs,
	createClipboardPlugin,
} from "@/plugins/clipboard.ts";
import { isNotImplemented } from "@/plugins/define.ts";

/** An adapter that records what it was asked and answers as told. */
function fake(overrides: Partial<ClipboardAdapter> = {}): ClipboardAdapter & {
	written: string[];
} {
	const written: string[] = [];
	return {
		written,
		readText: () => "",
		writeText: (text) => {
			written.push(text);
			return "written";
		},
		readImage: () => new Uint8Array(0),
		writeImage: () => "written",
		...overrides,
	};
}

describe("clipboard without an adapter", () => {
	test("names NSPasteboard instead of answering an empty clipboard", async () => {
		const plugin = createClipboardPlugin();
		for (const command of ["read", "write", "readImage", "writeImage"] as const) {
			const answer = await plugin.commands[command]();
			expect(isNotImplemented(answer)).toBe(true);
			if (isNotImplemented(answer)) {
				expect(answer.code).toBe("not-implemented");
				expect(answer.requires).toBe("NSPasteboard");
			}
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(clipboardPlugin.name).toBe("clipboard");
		expect(Object.keys(clipboardPlugin.commands)).toEqual([
			"read",
			"write",
			"readImage",
			"writeImage",
		]);
	});
});

describe("clipboard read", () => {
	test("an empty pasteboard is the empty string, not a failure", async () => {
		const plugin = createClipboardPlugin(fake());
		expect(await plugin.commands.read()).toEqual({ ok: true, text: "" });
	});

	test("hands the pasteboard text through unchanged", async () => {
		const text = "two\nlines and a tab\t";
		const plugin = createClipboardPlugin(fake({ readText: () => text }));
		expect(await plugin.commands.read()).toEqual({ ok: true, text });
	});

	test("a native null is not-implemented, because there was no pasteboard", async () => {
		const plugin = createClipboardPlugin(fake({ readText: () => null }));
		const answer = await plugin.commands.read();
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("NSPasteboard");
	});

	test("an adapter that throws answers a typed failure, never a throw", async () => {
		const plugin = createClipboardPlugin(
			fake({
				readText: () => {
					throw new Error("pasteboard is gone");
				},
			}),
		);
		expect(await plugin.commands.read()).toEqual({
			ok: false,
			code: "handler-error",
			message: "pasteboard is gone",
		} satisfies ClipboardFailure);
	});

	test("an adapter missing readText is named, not called", async () => {
		const plugin = createClipboardPlugin({} as ClipboardAdapter);
		expect(await plugin.commands.read()).toEqual({
			ok: false,
			code: "unknown-adapter",
			message: "crust: clipboard adapter does not implement readText",
		});
	});
});

describe("clipboard write", () => {
	test("a written string is ok only because the pasteboard said so", async () => {
		const adapter = fake();
		const plugin = createClipboardPlugin(adapter);
		expect(await plugin.commands.write({ text: "hello" })).toEqual({ ok: true, written: true });
		expect(adapter.written).toEqual(["hello"]);
	});

	test("the empty string is a legitimate write", async () => {
		const adapter = fake();
		const plugin = createClipboardPlugin(adapter);
		expect(await plugin.commands.write({ text: "" })).toEqual({ ok: true, written: true });
		expect(adapter.written).toEqual([""]);
	});

	test("a refusal is write-failed and keeps the verdict", async () => {
		const adapter = fake({ writeText: () => "refused" });
		const answer = await createClipboardPlugin(adapter).commands.write({ text: "x" });
		expect(answer).toEqual({
			ok: false,
			code: "write-failed",
			message: "clipboard.write: the general pasteboard did not take the string (refused)",
		});
	});

	test("a missing pasteboard is not-implemented, not a refusal", async () => {
		const adapter = fake({ writeText: () => "missing" });
		const answer = await createClipboardPlugin(adapter).commands.write({ text: "x" });
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("NSPasteboard");
	});

	test("a non-string is refused before the adapter is touched", async () => {
		const adapter = fake();
		const plugin = createClipboardPlugin(adapter);
		// A page can send anything over the bridge, so each of these is a payload
		// the handler has to refuse rather than throw on.
		const payloads: unknown[] = [undefined, {}, { text: 5 }, { text: null }];
		for (const payload of payloads) {
			const answer = await plugin.commands.write(payload as ClipboardWriteArgs);
			expect(answer).toEqual({
				ok: false,
				code: "bad-request",
				message: 'clipboard.write: "text" must be a string',
			});
		}
		expect(adapter.written).toEqual([]);
	});

	test("an adapter that throws answers a typed failure, never a throw", async () => {
		const adapter = fake({
			writeText: () => {
				throw new Error("NSPasteboard refused the selector");
			},
		});
		expect(await createClipboardPlugin(adapter).commands.write({ text: "x" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "NSPasteboard refused the selector",
		});
	});
});
