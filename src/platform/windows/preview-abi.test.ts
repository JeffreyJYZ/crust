/**
 * The preview host's `bun:ffi` table against the C it names: arity and width for all seven symbols.
 *
 * `ffi-abi.test.ts` walks the declaration maps through `c-abi.ts`, which keys on a literal
 * `symbols: {`; this table is `previewSymbols = {`, so it is checked here instead of silently
 * skipped. Widths are Windows LLP64: an integer is 32 bits, a pointer, a `cstring` and a `shim_i64`
 * are 64. The one widened return is `shim_preview_hresult`, because a failed HRESULT has to arrive
 * negative.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cFunctions, cWidth, ffiWidth } from "./c-abi.ts";
import { readShimPart } from "./shim-source.ts";

const DIR = import.meta.dir;
const BINDING = readFileSync(join(DIR, "ffi-preview.ts"), "utf8");
const ENTRY = /([a-z_][\w_]*):\s*\{\s*args:\s*\[([^\]]*)\]\s*,\s*returns:\s*([A-Za-z_][\w.]*)/g;

const declared = [...BINDING.matchAll(ENTRY)].map((match) => ({
	name: match[1] ?? "",
	args: (match[2] ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean),
	returns: match[3] ?? "",
}));

const definitions = new Map(
	[
		...cFunctions("53_preview_host.c", readShimPart("53_preview_host.c")),
		...cFunctions("54_preview.c", readShimPart("54_preview.c")),
		...cFunctions("55_preview_init.c", readShimPart("55_preview_init.c")),
	].map((fn) => [fn.name, fn]),
);

describe("the table and the C agree", () => {
	test("all seven exports are declared, and nothing else is", () => {
		expect(declared.map((symbol) => symbol.name).sort()).toEqual([
			"shim_preview_hide",
			"shim_preview_hresult",
			"shim_preview_hwnd",
			"shim_preview_ready",
			"shim_preview_show",
			"shim_preview_size",
			"shim_preview_step",
		]);
	});

	test("every declared symbol is a C definition", () => {
		expect(declared.filter((symbol) => !definitions.has(symbol.name))).toEqual([]);
	});

	test("the argument count matches the prototype", () => {
		const wrong: string[] = [];
		for (const symbol of declared) {
			const fn = definitions.get(symbol.name);
			if (fn && fn.params.length !== symbol.args.length) {
				wrong.push(`${symbol.name}: C ${fn.params.length}, FFI ${symbol.args.length}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	test("every argument and return is the width Windows uses", () => {
		const wrong: string[] = [];
		for (const symbol of declared) {
			const fn = definitions.get(symbol.name);
			if (!fn) continue;
			const returns = [cWidth(fn.returnType), ffiWidth(symbol.returns)];
			if (returns[0] !== returns[1])
				wrong.push(`${symbol.name} return ${returns.join(" vs ")}`);
			for (let index = 0; index < Math.min(fn.params.length, symbol.args.length); index++) {
				const widths = [cWidth(fn.params[index] ?? ""), ffiWidth(symbol.args[index] ?? "")];
				if (widths[0] !== widths[1])
					wrong.push(`${symbol.name}[${index}] ${widths.join(" vs ")}`);
			}
		}
		expect(wrong).toEqual([]);
	});
});

describe("the two returns a caller reads as a number", () => {
	/**
	 * The handle crosses as `shim_h` (a pointer) and the HRESULT as `shim_i64`: declared `int` here,
	 * `0x80004005` would arrive as `2147500037` and a `kind < 0` test would never fire.
	 */
	test("the host handle is a pointer and the HRESULT is widened", () => {
		const hwnd = definitions.get("shim_preview_hwnd");
		const hresult = definitions.get("shim_preview_hresult");
		expect(hwnd?.returnType).toBe("shim_h");
		expect(hresult?.returnType).toBe("shim_i64");
		expect(BINDING).toContain("shim_preview_hwnd: { args: [], returns: P }");
		expect(BINDING).toContain("shim_preview_hresult: { args: [], returns: I64 }");
	});
});
