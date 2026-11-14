/**
 * The seam nothing else checks: `shim.c` compiles and its selectors are
 * preflighted, but the JSON-style argument list in `index.ts` is what `bun:ffi`
 * uses to place values in registers. Add a parameter to a C function without
 * updating that list and every argument shifts by one — no error, no crash,
 * just the wrong value in the wrong place.
 *
 * This cost a real defect: a four-argument call to the five-argument
 * `shim_open_panel` put `allowMultiple` into `runModal` and opened a modal file
 * picker inside the test suite. The test parses both sides and compares arity, so
 * that mistake fails here instead of on someone's screen.
 *
 * Both sides may be split across several files by responsibility — the C unit
 * stays one translation unit by concatenation, and the binding may live in its
 * own module — so the test finds them instead of naming one path.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;

/** Parameter count for every function defined in a C file, by name. */
function cArities(source: string): Map<string, number> {
	const arities = new Map<string, number>();
	// A definition starts at column 0 with a return type and a name, then `(`.
	const start = /^[A-Za-z_][\w \t*]*?[\s*]([a-z_][\w_]*)\s*\(/gm;
	for (const match of source.matchAll(start)) {
		const name = match[1];
		if (name === undefined) continue;
		const open = (match.index ?? 0) + match[0].length - 1;
		// Balance parentheses to the end of the parameter list; a body's own
		// parentheses never sit at depth 0 of the declaration.
		let depth = 0;
		let close = -1;
		for (let index = open; index < source.length; index++) {
			const char = source[index];
			if (char === "(") depth++;
			else if (char === ")") {
				depth--;
				if (depth === 0) {
					close = index;
					break;
				}
			}
		}
		if (close === -1) continue;
		// Only a definition counts: a prototype ends at `;`.
		let after = close + 1;
		while (after < source.length && /\s/.test(source[after] ?? "")) after++;
		if (source[after] !== "{") continue;

		const params = source.slice(open + 1, close).trim();
		if (params.length === 0 || params === "void") {
			arities.set(name, 0);
			continue;
		}
		let count = 1;
		depth = 0;
		for (const char of params) {
			if (char === "(") depth++;
			else if (char === ")") depth--;
			else if (char === "," && depth === 0) count++;
		}
		arities.set(name, count);
	}
	return arities;
}

/** Declared arity for every symbol in the `symbols: { … }` block of a binding. */
function declaredArities(source: string): Map<string, number> {
	const blockStart = source.indexOf("symbols: {");
	expect(blockStart).toBeGreaterThan(-1);
	const block = source.slice(blockStart);
	const arities = new Map<string, number>();
	const entry = /([a-z_][\w_]*):\s*\{\s*args:\s*\[([^\]]*)\]/g;
	for (const match of block.matchAll(entry)) {
		const name = match[1];
		const list = (match[2] ?? "").trim();
		if (name === undefined) continue;
		const count = list.length === 0 ? 0 : list.split(",").filter((part) => part.trim()).length;
		arities.set(name, count);
	}
	return arities;
}

/**
 * Every C source under this directory that defines a `shim_*` function, joined
 * in path order. One file or several parts both read as one unit, which is what
 * `cc()` compiles.
 */
function shimCSource(): string {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".c")) files.push(path);
		}
	};
	walk(DIR);
	const parts = files
		.map((path) => [path, readFileSync(path, "utf8")] as const)
		.filter(([, source]) => /\bshim_[a-z_]*\s*\(/.test(source))
		.sort(([left], [right]) => left.localeCompare(right));
	if (parts.length === 0) throw new Error("crust: no C source defines the shim functions");
	return parts.map(([, source]) => source).join("\n");
}

/** The module holding the shim's `symbols: { … }` block, whatever it is called. */
function bindingSource(): string {
	const candidates = readdirSync(DIR)
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
		.sort();
	for (const name of candidates) {
		const source = readFileSync(join(DIR, name), "utf8");
		if (source.includes("symbols: {") && source.includes("shim_window_new")) return source;
	}
	throw new Error("crust: no module declares the shim bindings");
}

const shimC = shimCSource();
const indexTs = bindingSource();

describe("bun:ffi declarations match the C prototypes", () => {
	const c = cArities(shimC);
	const declared = declaredArities(indexTs);

	test("the parser saw the C functions it is meant to check", () => {
		// If this fails the test is worthless even when it reports no mismatch.
		for (const name of [
			"shim_window_new",
			"shim_open_panel",
			"shim_save_panel",
			"shim_webview_load",
		]) {
			expect(c.has(name)).toBe(true);
		}
		expect(c.get("shim_open_panel")).toBe(5);
		expect(c.get("shim_save_panel")).toBe(4);
		expect(c.get("shim_webview_load")).toBe(2);
		expect(c.get("shim_send_p0")).toBe(2);
	});

	test("every declared symbol exists in the C file", () => {
		const missing = [...declared.keys()].filter((name) => !c.has(name));
		expect(missing).toEqual([]);
	});

	test("every declared symbol has the same arity as its C function", () => {
		const mismatched: string[] = [];
		for (const [name, declaredArgs] of declared) {
			const fromC = c.get(name);
			if (fromC === undefined) continue; // reported by the previous test
			if (fromC !== declaredArgs) {
				mismatched.push(`${name}: C takes ${fromC}, declaration gives ${declaredArgs}`);
			}
		}
		expect(mismatched).toEqual([]);
	});
});
