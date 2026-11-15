/**
 * The macOS deep-link half, proven without launching an app. The C unit is compiled and its argv scan driven with a real pointer table — that never installs a delegate or opens a window — and every read case drives a fake shim, so nothing here claims a URL was delivered by macOS.
 */

import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import {
	argvTable,
	darwinDeepLinkAdapter,
	deepLinkUnit,
	type DeepLinkShim,
	DEEPLINK_STATUS,
	installDeepLinkHandler,
	installReason,
	takeLaunchUrl,
	URL_CHUNK,
} from "@/platform/darwin/deep-link.ts";

const notDarwin = process.platform !== "darwin";

/** A shim that answers as told, so no case needs AppKit. */
function shim(overrides: Partial<DeepLinkShim> = {}): DeepLinkShim {
	return {
		install: () => DEEPLINK_STATUS.installed,
		last: () => -1,
		clear: () => {},
		argv: () => 0,
		...overrides,
	};
}

/** A shim holding one URL, the way the C buffer does, and reporting sizes asked for. */
function holding(initial: string | null, sizes: number[] = []) {
	let held = initial;
	const native: DeepLinkShim = {
		install: () => DEEPLINK_STATUS.installed,
		last: (into) => {
			sizes.push(into.length);
			if (held === null) return -1;
			const bytes = new TextEncoder().encode(held);
			const copied = Math.min(bytes.length, into.length - 1);
			into.set(bytes.subarray(0, copied));
			into[copied] = 0;
			return bytes.length;
		},
		clear: () => {
			held = null;
		},
		argv: (args) => {
			const found = args.find((arg) => arg.includes("://"));
			if (found === undefined) return 0;
			held = found;
			return 1;
		},
	};
	return { native, held: () => held };
}

describe("deep-link C unit", () => {
	test.skipIf(notDarwin)("compiles through cc() and scans argv for a URL", () => {
		const unit = deepLinkUnit();
		// Nothing recorded yet, so the reader says so rather than answering "".
		expect(Number(unit.symbols.crust_deeplink_last(ptr(new Uint8Array(64)), 64))).toBe(-1);
		const table = argvTable([
			"/Applications/Example.app/Contents/MacOS/example",
			"crust://open/7",
		]);
		expect(Number(unit.symbols.crust_deeplink_argv(table.count, ptr(table.table)))).toBe(1);
		const buffer = new Uint8Array(64);
		const length = Number(unit.symbols.crust_deeplink_last(ptr(buffer), 64));
		expect(new TextDecoder().decode(buffer.subarray(0, length))).toBe("crust://open/7");
		unit.symbols.crust_deeplink_clear();
		expect(Number(unit.symbols.crust_deeplink_last(ptr(buffer), 64))).toBe(-1);
	});
});

describe("the argv table", () => {
	test("carries one pointer per argument, NUL-terminated", () => {
		const table = argvTable(["example", "crust://open"]);
		expect(table.count).toBe(2);
		expect(table.table.length).toBe(3);
		expect(table.table[2]).toBe(0n);
		for (const bytes of table.keep) {
			expect(bytes[bytes.length - 1]).toBe(0);
		}
		expect(table.keep[1]?.[0]).toBe("c".charCodeAt(0));
	});
});

describe("deep-link adapter", () => {
	test("reports the C unit's own install status, never optimism", () => {
		expect(darwinDeepLinkAdapter(shim()).install().status).toBe(DEEPLINK_STATUS.installed);
		const taken = darwinDeepLinkAdapter(shim({ install: () => DEEPLINK_STATUS.delegateTaken }));
		expect(taken.install().reason).toMatch(/another app delegate/);
		expect(installReason(99)).toMatch(/unknown status 99/);
	});

	test("a launch URL comes from argv when nothing was recorded", () => {
		const { native } = holding(null);
		const adapter = darwinDeepLinkAdapter(native, ["/bin/example", "crust://open/42"]);
		expect(adapter.takeLaunchUrl()).toBe("crust://open/42");
	});

	test("no argument and no recorded URL is null, which the plugin reads as no link", () => {
		expect(darwinDeepLinkAdapter(shim(), ["/bin/example"]).takeLaunchUrl()).toBeNull();
	});

	test("a recorded URL wins over argv, since an Apple Event arrives before startup ends", () => {
		const { native } = holding("crust://event/first");
		expect(darwinDeepLinkAdapter(native, ["/bin/example"]).takeLaunchUrl()).toBe(
			"crust://event/first",
		);
	});

	test("a URL longer than the first buffer is re-read at its exact length", () => {
		const url = `crust://open/${"x".repeat(URL_CHUNK + 10)}`;
		const sizes: number[] = [];
		const { native } = holding(url, sizes);
		expect(darwinDeepLinkAdapter(native, ["/bin/example"]).takeLaunchUrl()).toBe(url);
		expect(sizes).toEqual([URL_CHUNK, url.length + 1]);
	});

	test("a pending URL is drained once, so a poll cannot replay it forever", () => {
		const { native, held } = holding("crust://open/9");
		const adapter = darwinDeepLinkAdapter(native, []);
		expect(adapter.takePendingUrl()).toBe("crust://open/9");
		expect(held()).toBeNull();
		expect(adapter.takePendingUrl()).toBeNull();
	});

	test("the convenience exports read through the shim they are handed", () => {
		expect(installDeepLinkHandler(shim()).status).toBe(DEEPLINK_STATUS.installed);
		const { native } = holding("crust://open/11");
		expect(takeLaunchUrl(native, ["/bin/example"])).toBe("crust://open/11");
	});
});
