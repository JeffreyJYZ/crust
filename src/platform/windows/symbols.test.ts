/**
 * The `cc()` symbol table — the seam that broke one step after the link worked.
 *
 * On the real runner (2026-11-16) the shim compiled, linked and returned, and the smoke then died on
 * `shim.shim_com_init is not a function`. Nothing was missing from the declaration map: `cc()` hands
 * back `{ symbols, close }`, so a cast straight to the bare table type is accepted by the compiler
 * and makes every call `undefined`. Two things pin it — the map covers every symbol the backend
 * calls, and the unwrap returns the table rather than the wrapper.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WindowsShim } from "./backend.ts";
import { shimSymbols } from "./ffi.ts";
import { lf } from "./shim-source.ts";

const DIR = import.meta.dir;

/**
 * Method names declared on `WindowsShim`. That interface is the whole contract: `platform.ts`,
 * `window-open.ts`, `teardown.ts` and `windows-registry.ts` all take a `WindowsShim`, so a symbol
 * outside it cannot be called and a member without a declaration cannot be reached.
 *
 * `WindowsShim` now extends its two halves (`backend-webview.ts`, `backend-namespaces.ts`) rather
 * than carrying every member inline, so the members are collected along that chain: reading only
 * `backend.ts` would find nothing and pass for the wrong reason.
 */
function interfaceMembers(): string[] {
	const root = lf(readFileSync(join(DIR, "backend.ts"), "utf8"));
	const head = /export interface WindowsShim([^{]*)\{/.exec(root)?.[1] ?? "";
	const inherited = [...head.matchAll(/(Windows\w+Shim)/g)].flatMap((match) =>
		membersOf(match[1] ?? ""),
	);
	return [...membersOf("WindowsShim"), ...inherited];
}

/** The body of one interface, from whichever of the three files declares it. */
function membersOf(name: string): string[] {
	for (const file of ["backend.ts", "backend-webview.ts", "backend-namespaces.ts"]) {
		const source = lf(readFileSync(join(DIR, file), "utf8"));
		const at = source.indexOf(`export interface ${name}`);
		if (at < 0) continue;
		// `extends` sits between the name and the brace, so the body starts at the next `{`.
		const start = source.indexOf("{", at);
		const end = source.indexOf("\n}", start);
		expect(end).toBeGreaterThan(start);
		const block = source.slice(start, end);
		return [...block.matchAll(/^\t([a-z_][\w]*)\(/gm)].map((match) => match[1] ?? "");
	}
	return [];
}

/** Keys of the `symbols: { … }` map handed to `cc()`, matched by their `args:` entry. */
function declaredSymbols(): string[] {
	// Four files declare the map: `ffi.ts` carries the window table, `ffi-webview.ts` the surface and
	// WebView2 symbols, `ffi-core.ts` the clipboard, opener and `os.info` symbols, and
	// `ffi-dialog.ts` the file panels. All are read, because a table in one file only would let this
	// cross-check pass while half the map went unexamined.
	return ["ffi.ts", "ffi-webview.ts", "ffi-core.ts", "ffi-dialog.ts"].flatMap((name) => {
		const source = lf(readFileSync(join(DIR, name), "utf8"));
		const start = source.indexOf("symbols: {");
		// `ffi-core.ts` exports the table itself, so the whole file is the block.
		const block = start >= 0 ? source.slice(start) : source;
		return [...block.matchAll(/([a-z_][\w]*):\s*\{\s*args:/g)].map((match) => match[1] ?? "");
	});
}

describe("the cc() symbol map", () => {
	test("declares every symbol the Windows backend calls", () => {
		const declared = new Set(declaredSymbols());
		const missing = interfaceMembers().filter((name) => !declared.has(name));
		expect(missing).toEqual([]);
	});

	test("declares nothing the backend cannot reach", () => {
		const members = new Set(interfaceMembers());
		const unreachable = declaredSymbols().filter((name) => !members.has(name));
		expect(unreachable).toEqual([]);
	});

	// A parser that silently found nothing would make both tests above pass for the wrong reason.
	test("the parsers saw both sides", () => {
		expect(interfaceMembers()).toContain("shim_com_init");
		expect(interfaceMembers()).toContain("shim_win32_ready");
		expect(declaredSymbols()).toContain("shim_com_init");
		expect(interfaceMembers().length).toBeGreaterThanOrEqual(14);
		expect(declaredSymbols().length).toBe(interfaceMembers().length);
	});
});

describe("the table cc() returns", () => {
	/**
	 * `cc()` wraps the symbols, so the unwrap has to happen once. Returning the wrapper is exactly
	 * the defect: it type-checks as `WindowsShim` through a cast and every call is `undefined`.
	 */
	test("is unwrapped, because cc() hands back { symbols, close }", () => {
		const table = { shim_com_init: () => 0 } as unknown as WindowsShim;
		const library = { symbols: table, close: () => {} };
		expect(shimSymbols(library)).toBe(table);
		expect(shimSymbols(library).shim_com_init).toBeTypeOf("function");
	});

	test("compile() returns the unwrapped table, not the library", () => {
		const source = lf(readFileSync(join(DIR, "ffi.ts"), "utf8"));
		const start = source.indexOf("export function compile(");
		expect(start).toBeGreaterThan(-1);
		// `return shimSymbols(cc({ … }))` — a bare `return cc({ … })` is the regression.
		expect(source.slice(start)).toContain("return shimSymbols(");
	});
});
