/**
 * Generation-time refusals for `renderBindings`. Both defects here were previously emitted as code: a
 * symbol named after a generated local produced an unparseable module, and a mistyped or duplicated
 * SymbolSpec produced a mis-bound or duplicate `export const`. Each test would have passed on main
 * only by accepting broken output; now the generator refuses with the symbol and the reason.
 */
import { describe, expect, test } from "bun:test";

import type { SymbolSpec } from "./extension-bindings";
import { renderBindings } from "./extension-bindings";

const transpiler = new Bun.Transpiler({ loader: "ts" });

const VOID: SymbolSpec = { name: "reset", args: [], returns: "void" };

describe("renderBindings refuses generated-name collisions", () => {
	const generated = ["ffi", "DYLIB", "open", "reload", "join", "dlopen", "FFIType", "ABI"];

	test("every name the generated module declares at module scope is refused, naming the symbol", () => {
		for (const name of generated) {
			const symbol: SymbolSpec = { name, args: [], returns: "void" };
			expect(() => renderBindings({ name: "math", symbols: [symbol] })).toThrow(name);
		}
	});

	test("the refusal names open and gives a reason the author can act on", () => {
		expect(() =>
			renderBindings({ name: "math", symbols: [{ ...VOID, name: "open" }] }),
		).toThrow(/open[\s\S]*collides[\s\S]*rename|collides[\s\S]*open/);
	});

	test("strict-mode-illegal arguments is refused with the symbol and the reason", () => {
		expect(() =>
			renderBindings({ name: "math", symbols: [{ ...VOID, name: "arguments" }] }),
		).toThrow(/arguments[\s\S]*strict mode/);
	});

	test("a symbol called open is either refused with its name or emitted as a module that parses", () => {
		let text: string | undefined;
		try {
			text = renderBindings({
				name: "math",
				symbols: [{ name: "open", args: ["i32"], returns: "i32" }],
			});
		} catch (error) {
			expect(String(error)).toContain("open");
			expect(String(error)).toMatch(/collides|generated|rename|strict mode/);
			return;
		}
		expect(() => transpiler.transformSync(text as string)).not.toThrow();
	});

	test("a normal C symbol still generates a module that parses", () => {
		const text = renderBindings({
			name: "math",
			symbols: [{ name: "add", args: ["i32", "i32"], returns: "i32" }],
		});
		expect(() => transpiler.transformSync(text)).not.toThrow();
	});
});

describe("renderBindings validates SymbolSpecs", () => {
	test("a duplicate symbol name is refused, naming the symbol", () => {
		expect(() => renderBindings({ name: "math", symbols: [VOID, { ...VOID }] })).toThrow(
			/reset[\s\S]*more than once/,
		);
	});

	test("an unknown argument type is refused, naming the symbol and the type", () => {
		const bad = { name: "add", args: ["int"], returns: "i32" } as unknown as SymbolSpec;
		expect(() => renderBindings({ name: "math", symbols: [bad] })).toThrow(/add[\s\S]*int/);
	});

	test("an unknown return type is refused, naming the symbol and the type", () => {
		const bad = { name: "add", args: [], returns: "int" } as unknown as SymbolSpec;
		expect(() => renderBindings({ name: "math", symbols: [bad] })).toThrow(/add[\s\S]*int/);
	});

	test("void as an argument is refused: there is no argument projection for it", () => {
		const bad = { name: "add", args: ["void"], returns: "i32" } as unknown as SymbolSpec;
		expect(() => renderBindings({ name: "math", symbols: [bad] })).toThrow(/add[\s\S]*void/);
	});

	test("valid specs are still accepted and parse", () => {
		const text = renderBindings({
			name: "math",
			symbols: [
				{ name: "add", args: ["i32", "i32"], returns: "i32" },
				{ name: "greet", args: ["cstring"], returns: "cstring" },
				VOID,
			],
		});
		expect(() => transpiler.transformSync(text)).not.toThrow();
	});
});
