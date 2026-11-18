/**
 * The Windows equivalent of `darwin/arity.test.ts`, plus the width half: every `bun:ffi` declaration
 * is checked against the C function it names. Nothing here needs Windows — the source is parsed, not
 * executed — so the audit runs on the darwin CI runner as well as on a Windows arm runner.
 *
 * Widths alone do not catch the arm64 defect: a 16-byte `RECT` is 16 bytes on both ABIs, but x64
 * passes it by pointer and ARM64 passes it in consecutive general-purpose registers. The last test
 * therefore locks the `__aarch64__` branch to a by-value call.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cFunctions, cSources, cWidth, ffiSymbols, ffiWidth } from "./c-abi.ts";

const DIR = import.meta.dir;
const sources = cSources(join(DIR, "shim"));
const definitions = new Map<string, ReturnType<typeof cFunctions>[number]>();
for (const [file, source] of sources) {
	for (const fn of cFunctions(file, source)) definitions.set(fn.name, fn);
}

const bindings = readdirSync(DIR)
	.filter((name) => (name === "ffi.ts" || name.endsWith("-ffi.ts")) && !name.endsWith(".test.ts"))
	.sort();
const declared = bindings.flatMap((name) =>
	ffiSymbols(name, readFileSync(join(DIR, name), "utf8")),
);

describe("the C parser sees the shim it is meant to check", () => {
	test("both translation units and the probe functions were parsed", () => {
		expect(sources.has("34_slots.c")).toBe(true);
		expect(sources.has("48_keychain.c")).toBe(true);
		for (const name of ["shim_env_begin", "wv2_put_bounds", "shim_keychain_get"]) {
			expect(definitions.has(name)).toBe(true);
		}
		expect(definitions.get("wv2_put_bounds")?.params.length).toBe(3);
	});

	test("the binding walk found every FFI module", () => {
		expect(bindings).toContain("ffi.ts");
		expect(bindings).toContain("keychain-ffi.ts");
		expect(declared.length).toBeGreaterThanOrEqual(60);
	});

	test("Windows LLP64 widths: long is 32, long long and pointers are 64", () => {
		expect(cWidth("long")).toBe(4);
		expect(cWidth("unsigned long long")).toBe(8);
		expect(cWidth("shim_h")).toBe(8);
		expect(cWidth("shim_wchar")).toBe(2);
		expect(ffiWidth("FFIType.u32")).toBe(4);
		expect(ffiWidth("P")).toBe(8);
	});
});

describe("bun:ffi declarations match the C prototypes they name", () => {
	test("every declared symbol exists as a C definition", () => {
		const missing = declared
			.map((symbol) => symbol.name)
			.filter((name) => !definitions.has(name));
		expect(missing).toEqual([]);
	});

	test("argument count agrees with the C prototype", () => {
		const wrong: string[] = [];
		for (const symbol of declared) {
			const fn = definitions.get(symbol.name);
			if (fn && fn.params.length !== symbol.args.length) {
				wrong.push(`${symbol.name}: C ${fn.params.length}, FFI ${symbol.args.length}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	test("return and argument widths agree with the C prototype", () => {
		const wrong: string[] = [];
		for (const symbol of declared) {
			const fn = definitions.get(symbol.name);
			if (!fn) continue; // reported by the existence test
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

describe("the arm64-specific call shape", () => {
	const slots = sources.get("34_slots.c") ?? "";
	test("put_Bounds passes the 16-byte RECT by value on arm64, by pointer on x64", () => {
		// ARM64 ABI stage B.3 copies only composites *larger* than 16 bytes; C.10 loads a
		// 16-byte composite into consecutive GPRs. x64 passes a >8-byte struct by pointer.
		expect(slots).toContain("#if defined(__aarch64__)");
		const arm = slots.slice(slots.indexOf("__aarch64__"));
		const byValue =
			/\(\(int \(\*\)\(void \*, shim_rect\)\)vt\[SHIM_SLOT_CONTROLLER_PUT_BOUNDS\]\)\(ctrl, r\)/;
		expect(byValue.test(arm)).toBe(true);
		expect(arm.slice(0, arm.indexOf("#else"))).not.toContain("&r");
	});
});
