/**
 * The Windows half of the C/declaration audit: parse C function definitions and FFI symbol maps so a
 * test can compare arity and width without a Windows SDK. Modelled on `darwin/arity.test.ts`; split
 * out so the test file stays under the line cap.
 *
 * Widths are Windows LLP64: `int`, `long`, `DWORD` are 32 bits; pointers, `long long`, `SIZE_T` and
 * `double` are 64. That is true on both x64 and arm64 — what differs between them is how a 16-byte
 * struct crosses a call, which the test asserts from source rather than from a type width.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CFunction {
	file: string;
	name: string;
	returnType: string;
	params: string[];
}

export interface FfiSymbol {
	file: string;
	name: string;
	args: string[];
	returns: string;
}

/** A definition starts at column 0: `<return type><name>(`. A prototype ends at `;`, not `{`. */
const DEFINITION = /^([A-Za-z_][\w \t*]*?[\s*])([a-z_][\w_]*)\s*\(/gm;

function closeParen(source: string, open: number): number {
	let depth = 0;
	for (let index = open; index < source.length; index++) {
		const char = source[index];
		if (char === "(") depth++;
		else if (char === ")" && --depth === 0) return index;
	}
	return -1;
}

function splitParams(text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed || trimmed === "void") return [];
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < trimmed.length; index++) {
		const char = trimmed[index];
		if (char === "(" || char === "[") depth++;
		else if (char === ")" || char === "]") depth--;
		else if (char === "," && depth === 0) {
			parts.push(trimmed.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(trimmed.slice(start));
	return parts;
}

export function cFunctions(file: string, source: string): CFunction[] {
	const found: CFunction[] = [];
	for (const match of source.matchAll(DEFINITION)) {
		const name = match[2];
		if (name === undefined) continue;
		const open = (match.index ?? 0) + match[0].length - 1;
		const close = closeParen(source, open);
		if (close < 0) continue;
		let after = close + 1;
		while (after < source.length && /\s/.test(source[after] ?? "")) after++;
		if (source[after] !== "{") continue; // a prototype, not a definition
		const params = splitParams(source.slice(open + 1, close)).map((param) =>
			param
				.trim()
				.replace(/\s+[A-Za-z_]\w*$/, "")
				.replace(/\s+/g, " ")
				.trim(),
		);
		found.push({ file, name, returnType: (match[1] ?? "").trim(), params });
	}
	return found;
}

/** Every `.c` in the shim directory, including the separately compiled keychain unit. */
export function cSources(dir: string): Map<string, string> {
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".c"))
		.sort();
	return new Map(files.map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

/** Every FFI symbol map in a binding module, with its argument and return tokens. */
export function ffiSymbols(file: string, source: string): FfiSymbol[] {
	// Two shapes are in use: an inline `symbols: { … }` map (the window and keychain tables) and an
	// exported `…Symbols = { … }` table that the map spreads in (`ffi-core`, `ffi-dialog`,
	// `ffi-webview`). Both are symbol maps and both must be audited against the C they name.
	const inline = source.indexOf("symbols: {");
	const exported = source.search(/[A-Za-z_]\w*Symbols\s*=\s*\{/);
	const starts = [inline, exported].filter((at) => at >= 0);
	if (starts.length === 0) return [];
	const start = Math.min(...starts);
	const entry = /([a-z_][\w_]*):\s*\{\s*args:\s*\[([^\]]*)\]\s*,\s*returns:\s*([A-Za-z_][\w.]*)/g;
	const found: FfiSymbol[] = [];
	for (const match of source.slice(start).matchAll(entry)) {
		const name = match[1];
		if (name === undefined) continue;
		const args = (match[2] ?? "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		found.push({ file, name, args, returns: (match[3] ?? "").trim() });
	}
	return found;
}

/** Byte width of a C type on Windows (both x64 and arm64), or undefined when unclassified. */
export function cWidth(raw: string): number | undefined {
	const type = raw
		.replace(/\b(?:const|volatile|static|register)\b/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!type || type === "void") return 0;
	if (type.includes("*")) return 8;
	if (/^(shim_h|kc_h|shim_i64|shim_u64|size_t|unsigned long long|long long|double)$/.test(type))
		return 8;
	if (/^(unsigned )?(int|long)$/.test(type)) return 4;
	if (/^(unsigned )?short$/.test(type)) return 2;
	if (/^(unsigned )?char$/.test(type)) return 1;
	if (/^(shim_wchar|kc_wchar)$/.test(type)) return 2;
	if (/^(kc_dword|DWORD|UINT|BOOL|HRESULT)$/.test(type)) return 4;
	if (type === "float") return 4;
	return undefined;
}

/** Byte width of a `bun:ffi` token, or undefined when unclassified. */
export function ffiWidth(raw: string): number | undefined {
	const type = raw.replace(/^FFIType\./, "").trim();
	switch (type) {
		case "void":
		case "V":
			return 0;
		case "i32":
		case "u32":
		case "I32":
		case "f32":
		case "F32":
			return 4;
		case "i64":
		case "u64":
		case "I64":
		case "f64":
		case "F64":
		case "ptr":
		case "P":
		case "cstring":
		case "CS":
			return 8;
		default:
			return undefined;
	}
}
