import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ABI_SYMBOL, type SymbolSpec, renderBindings, writeBindings } from "./extension-bindings";
import { dylibSuffix } from "./extension-tools";

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** The generated module must be real TypeScript, so it goes through the parser every time. */
function parses(text: string): boolean {
	transpiler.transformSync(text);
	return true;
}

const ADD: SymbolSpec = { name: "add", args: ["i32", "i32"], returns: "i32" };

describe("renderBindings", () => {
	test("dlopens the dylib beside the generated module", () => {
		const text = renderBindings({ name: "math", symbols: [ADD] });
		expect(text).toContain(`const DYLIB = join(import.meta.dir, "math${dylibSuffix()}");`);
	});

	test("declares the symbol map and the typed export exactly", () => {
		const text = renderBindings({ name: "math", symbols: [ADD] });
		expect(text).toContain(
			"\t\tadd: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },",
		);
		expect(text).toContain(
			"export const add = (a0: number, a1: number): number => ffi.symbols.add(a0, a1);",
		);
	});

	test("i64 is bigint, cstring returns string | null, void returns void", () => {
		const text = renderBindings({
			name: "math",
			symbols: [
				{ name: "total", args: ["i64", "u64"], returns: "i64" },
				{ name: "greet", args: ["cstring"], returns: "cstring" },
				{ name: "reset", args: [], returns: "void" },
			],
		});
		expect(text).toContain(
			"export const total = (a0: bigint, a1: bigint): bigint => " +
				"ffi.symbols.total(a0, a1);",
		);
		expect(text).toContain(
			"export const greet = (a0: string): string | null => ffi.symbols.greet(a0);",
		);
		expect(text).toContain("export const reset = (): void => ffi.symbols.reset();");
		expect(text).toContain("\t\treset: { args: [], returns: FFIType.void },");
	});

	test("a symbol is called through the handle, never captured at module evaluation", () => {
		const text = renderBindings({ name: "math", symbols: [ADD] });
		// `ffi.symbols.add` destructured or assigned once would keep answering from the first build.
		expect(text).not.toContain("ffi.symbols.add as");
		expect(text).toContain("let ffi = open();");
		expect(text).toContain("export function reload(): void {");
		expect(text).toContain("\tffi.close();");
		expect(text).toContain("\tffi = open();");
	});

	test("with no abiVersion the marker is not declared, so a bare dylib still binds", () => {
		const text = renderBindings({ name: "math", symbols: [ADD] });
		expect(text).not.toContain(ABI_SYMBOL);
		expect(text).not.toContain("const ABI =");
	});

	test("an abiVersion declares the marker and refuses a dylib that answers another", () => {
		const text = renderBindings({ name: "math", symbols: [ADD], abiVersion: 3 });
		expect(text).toContain(`\t\t${ABI_SYMBOL}: { args: [], returns: FFIType.i32 },`);
		expect(text).toContain(`const ABI = 3;`);
		expect(text).toContain(`const abi = ffi.symbols.${ABI_SYMBOL}();`);
		expect(text).toContain("rebuild the extension");
		expect(parses(text)).toBe(true);
	});

	test("every declared type reaches the ffi table", () => {
		const text = renderBindings({
			name: "math",
			symbols: [
				{ name: "p", args: ["ptr", "f64", "u32"], returns: "ptr" },
				{ name: "f", args: ["u64"], returns: "f64" },
			],
		});
		expect(text).toContain(
			"\t\tp: { args: [FFIType.ptr, FFIType.f64, FFIType.u32], returns: FFIType.ptr },",
		);
		expect(text).toContain("\t\tf: { args: [FFIType.u64], returns: FFIType.f64 },");
	});

	test("a custom dylib name is the dlopen argument", () => {
		const text = renderBindings({ name: "math", symbols: [ADD], dylib: "libmath.dylib" });
		expect(text).toContain('const DYLIB = join(import.meta.dir, "libmath.dylib");');
	});

	test("an absolute dylib is refused rather than emitted as a broken join", () => {
		expect(() =>
			renderBindings({ name: "math", symbols: [ADD], dylib: "/tmp/math.dylib" }),
		).toThrow("relative to the generated module");
	});

	test("a symbol that cannot be an export name is refused", () => {
		expect(() =>
			renderBindings({
				name: "math",
				symbols: [{ name: "delete", args: [], returns: "void" }],
			}),
		).toThrow("not a usable TypeScript export name");
		expect(() =>
			renderBindings({
				name: "math",
				symbols: [{ name: "1bad", args: [], returns: "void" }],
			}),
		).toThrow("not a usable TypeScript export name");
	});

	test("the module parses, including with no symbols at all", () => {
		expect(parses(renderBindings({ name: "math", symbols: [ADD] }))).toBe(true);
		expect(parses(renderBindings({ name: "empty", symbols: [] }))).toBe(true);
		expect(parses(renderBindings({ name: "empty", symbols: [], abiVersion: 1 }))).toBe(true);
	});

	test("open() keeps the exact symbol types instead of an erased ReturnType", () => {
		const text = renderBindings({ name: "math", symbols: [ADD], abiVersion: 3 });
		expect(text).toContain("\tconst SPEC = {");
		expect(text).toContain("\t} as const;");
		expect(text).toContain("\tconst ffi = dlopen(DYLIB, SPEC);");
		expect(text).toContain("function open() {");
		expect(text).not.toContain("ReturnType<typeof dlopen>");
		expect(text).not.toContain("ffi.symbols.add as ");
	});

	test("the generated module type-checks with the real checker", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-bindings-check-"));
		try {
			const texts = [
				renderBindings({
					name: "math",
					abiVersion: 3,
					symbols: [
						ADD,
						{ name: "total", args: ["i64", "u64"], returns: "i64" },
						{ name: "greet", args: ["cstring"], returns: "cstring" },
						{ name: "reset", args: [], returns: "void" },
					],
				}),
				renderBindings({ name: "empty", symbols: [] }),
			];
			for (const [index, text] of texts.entries()) {
				await writeFile(join(dir, `mod${index}.ts`), text, "utf8");
			}
			const proc = Bun.spawn(
				["bun", "check", "-p", join(import.meta.dir, "../../tsconfig.json"), dir],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const output =
				(await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
			const code = await proc.exited;
			if (code !== 0) throw new Error(`generated module failed to type-check:\n${output}`);
			expect(code).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("writeBindings", () => {
	test("writes <name>.ts beside the dylib with the rendered text", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-bindings-"));
		try {
			const result = await writeBindings({ outDir: dir, name: "math", symbols: [ADD] });
			expect(result.path).toBe(join(dir, "math.ts"));
			expect(await readFile(result.path, "utf8")).toBe(result.text);
			expect(result.text).toBe(renderBindings({ name: "math", symbols: [ADD] }));
			expect(parses(result.text)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
