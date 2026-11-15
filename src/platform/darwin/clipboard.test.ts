/**
 * The macOS clipboard half, proven without a pasteboard. The C unit is compiled and its selectors probed — which never reads or writes the user's clipboard — and every read/write case drives a fake shim, so the suite cannot clobber what the human has copied.
 */

import { describe, expect, test } from "bun:test";
import {
	clipboardUnitStatus,
	darwinClipboardAdapter,
	IMAGE_CHUNK,
	type ClipboardShim,
	READ_CHUNK,
} from "@/platform/darwin/clipboard.ts";

const notDarwin = process.platform !== "darwin";

/** A shim that answers as told, so no case needs AppKit. */
function shim(overrides: Partial<ClipboardShim> = {}): ClipboardShim {
	return {
		available: () => true,
		read: () => 0,
		write: () => 1,
		readImage: () => 0,
		writeImage: () => 1,
		...overrides,
	};
}

/** Copy UTF-8 bytes into a caller buffer the way the C unit does, and report the full length. */
function fill(text: string) {
	return (into: Uint8Array): number => {
		const bytes = new TextEncoder().encode(text);
		const copied = Math.min(bytes.length, into.length - 1);
		into.set(bytes.subarray(0, copied));
		into[copied] = 0;
		return bytes.length;
	};
}

/** The same for image bytes, which are copied whole and carry no terminator. */
function fillBytes(bytes: Uint8Array) {
	return (into: Uint8Array): number => {
		into.set(bytes.subarray(0, Math.min(bytes.length, into.length)));
		return bytes.length;
	};
}

describe("clipboard C unit", () => {
	test.skipIf(notDarwin)("compiles through cc() and answers every selector", () => {
		// `cc()` refuses a symbol it cannot resolve, and both `available()` guards
		// run in C, so this is the proof AppKit serves the text and image halves.
		const status = clipboardUnitStatus();
		expect(status.reason).toBe("compiled");
		expect(status.available).toBe(true);
	});
});

describe("clipboard adapter read", () => {
	test("an empty pasteboard reads as the empty string", () => {
		expect(darwinClipboardAdapter(shim()).readText()).toBe("");
	});

	test("decodes UTF-8, multi-byte characters included", () => {
		const text = "héllo — 世界\n";
		expect(darwinClipboardAdapter(shim({ read: fill(text) })).readText()).toBe(text);
	});

	test("a text longer than the first buffer is re-read at its exact length", () => {
		const text = "x".repeat(READ_CHUNK + 10);
		const sizes: number[] = [];
		const adapter = darwinClipboardAdapter(
			shim({
				read: (into) => {
					sizes.push(into.length);
					return fill(text)(into);
				},
			}),
		);
		expect(adapter.readText()).toBe(text);
		expect(sizes).toEqual([READ_CHUNK, text.length + 1]);
	});

	test("a missing pasteboard is null, which the plugin reports as not-implemented", () => {
		expect(darwinClipboardAdapter(shim({ read: () => -1 })).readText()).toBeNull();
	});
});

describe("clipboard adapter write", () => {
	test("passes the exact UTF-8 bytes and length, and reports written", () => {
		let seen: { bytes: Uint8Array; length: number } | undefined;
		const adapter = darwinClipboardAdapter(
			shim({
				write: (bytes, length) => {
					seen = { bytes, length };
					return 1;
				},
			}),
		);
		expect(adapter.writeText("héllo")).toBe("written");
		expect(seen?.length).toBe(6);
		expect(seen?.bytes.length).toBe(7);
		expect(seen?.bytes[6]).toBe(0);
	});

	test("an empty string still hands C a real, NUL-terminated buffer", () => {
		let seen: { bytes: Uint8Array; length: number } | undefined;
		const adapter = darwinClipboardAdapter(
			shim({
				write: (bytes, length) => {
					seen = { bytes, length };
					return 1;
				},
			}),
		);
		expect(adapter.writeText("")).toBe("written");
		expect(seen?.length).toBe(0);
		expect(seen?.bytes.length).toBe(1);
	});

	test("the pasteboard's own status is the verdict, never optimism", () => {
		expect(darwinClipboardAdapter(shim({ write: () => 0 })).writeText("x")).toBe("refused");
		expect(darwinClipboardAdapter(shim({ write: () => -1 })).writeText("x")).toBe("missing");
		expect(darwinClipboardAdapter(shim({ write: () => 1 })).writeText("x")).toBe("written");
	});
});

describe("clipboard adapter image read", () => {
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);

	test("an image comes back as the exact bytes the pasteboard held", () => {
		expect(darwinClipboardAdapter(shim({ readImage: fillBytes(PNG) })).readImage()).toEqual(
			PNG,
		);
	});

	test("a pasteboard holding no image is zero bytes, not a failure", () => {
		expect(darwinClipboardAdapter(shim()).readImage()).toEqual(new Uint8Array(0));
	});

	test("a missing pasteboard is null, which the plugin reports as not-implemented", () => {
		expect(darwinClipboardAdapter(shim({ readImage: () => -1 })).readImage()).toBeNull();
	});

	test("an image larger than the first buffer is re-read at its exact length", () => {
		const bytes = new Uint8Array(IMAGE_CHUNK + 10).fill(7);
		const sizes: number[] = [];
		const adapter = darwinClipboardAdapter(
			shim({
				readImage: (into) => {
					sizes.push(into.length);
					return fillBytes(bytes)(into);
				},
			}),
		);
		const png = adapter.readImage();
		expect(png?.length).toBe(bytes.length);
		expect(png?.[bytes.length - 1]).toBe(7);
		expect(sizes).toEqual([IMAGE_CHUNK, bytes.length]);
	});
});

describe("clipboard adapter image write", () => {
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

	test("hands C the exact bytes and length, with no terminator added", () => {
		let seen: { bytes: Uint8Array; length: number } | undefined;
		const adapter = darwinClipboardAdapter(
			shim({
				writeImage: (bytes, length) => {
					seen = { bytes, length };
					return 1;
				},
			}),
		);
		expect(adapter.writeImage(PNG)).toBe("written");
		expect(seen?.length).toBe(PNG.length);
		expect(seen?.bytes).toBe(PNG);
	});

	test("the pasteboard's own status is the verdict, never optimism", () => {
		expect(darwinClipboardAdapter(shim({ writeImage: () => 0 })).writeImage(PNG)).toBe(
			"refused",
		);
		expect(darwinClipboardAdapter(shim({ writeImage: () => -1 })).writeImage(PNG)).toBe(
			"missing",
		);
	});
});
