/**
 * **The frame rule, as code.** A local array of 4096 bytes or more makes TinyCC's PE code generator
 * emit `mov v, eax; call __chkstk` instead of the inline `sub rsp, imm32` prologue (`v` is the locals
 * plus the 32-byte `func_scratch`, and the branch is `v >= 4096`). Nothing in this unit's link set
 * defines `__chkstk`, so the call jumps into a relocation filled with `-1` — the
 * `0xFFFFFFFFFFFFFFFF` the Windows runs reported, measured on `windows-latest` with a 4096-byte probe
 * that died and a 2048-byte one that answered 1.
 *
 * So the unit may never grow a frame that big. `frame.test.ts` is what enforces it rather than a
 * comment someone has to remember; this module is the scan it runs, kept apart so the test file stays
 * under the line cap and so a probe script can print the same list.
 */
import { readShimPart, SHIM_PART_NAMES } from "./shim-source.ts";

/** Bytes per element, for every element type this unit declares. `*` is handled separately. */
const SIZES: Record<string, number> = {
	char: 1,
	"unsigned char": 1,
	int: 4,
	shim_wchar: 2,
	shim_u64: 8,
};

const POINTER = 8;

/** The frame size at which the prologue changes shape. */
export const FRAME_LIMIT = 4096;

/** Statement keywords that occupy the same slot as a type in `return buf[0]` and `sizeof x[1]`. */
const STATEMENTS = new Set([
	"return",
	"if",
	"else",
	"while",
	"for",
	"do",
	"switch",
	"case",
	"default",
	"break",
	"continue",
	"goto",
	"sizeof",
	"typedef",
	"struct",
	"union",
	"enum",
]);

export interface LocalArray {
	file: string;
	line: number;
	text: string;
	/** `undefined` when the element type or the bound could not be measured, which is also a failure. */
	bytes: number | undefined;
}

/** Comments and literals as spaces, so a comment documenting `shim_wchar x[4096]` is not a declaration. */
function blank(text: string): string {
	let out = "";
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		const next = text[index + 1];
		if (char === "/" && next === "*") {
			const end = text.indexOf("*/", index + 2);
			const stop = end < 0 ? text.length : end + 2;
			out += text.slice(index, stop).replace(/[^\n]/g, " ");
			index = stop;
		} else if (char === "/" && next === "/") {
			const end = text.indexOf("\n", index);
			const stop = end < 0 ? text.length : end;
			out += " ".repeat(stop - index);
			index = stop;
		} else if (char === '"' || char === "'") {
			let scan = index + 1;
			while (scan < text.length && text[scan] !== char) scan += text[scan] === "\\" ? 2 : 1;
			const stop = Math.min(scan + 1, text.length);
			out += " ".repeat(stop - index);
			index = stop;
		} else {
			out += char;
			index++;
		}
	}
	return out;
}

/** One declaration, when it is a local array. `static` storage lives in the image and costs no frame. */
function declaration(file: string, line: number, raw: string): LocalArray | undefined {
	const text = raw.trim();
	if (!text || /^static\b/.test(text)) return undefined;
	const shape =
		/^(?:volatile\s+|const\s+|register\s+|unsigned\s+|signed\s+)*([A-Za-z_][\w *]*?)\s+([A-Za-z_]\w*)\s*\[\s*([^[\]]+?)\s*\]$/.exec(
			text,
		);
	if (!shape) return undefined;
	const type = (shape[1] ?? "").replace(/\s+/g, " ").trim();
	if (STATEMENTS.has(type)) return undefined;
	const bound = shape[3] ?? "";
	const size = type.includes("*") ? POINTER : SIZES[type];
	const elements = /^\d+$/.test(bound) ? Number(bound) : undefined;
	const bytes = elements === undefined || size === undefined ? undefined : elements * size;
	return { file, line, text, bytes };
}

/**
 * Every local array in one shim part. Braces are tracked so a struct body and a file-scope declaration
 * are both skipped; `segment` accumulates a declaration across lines and resets at `;`, `{` and `}`.
 */
export function localArrays(file: string, source: string): LocalArray[] {
	const text = blank(source);
	const found: LocalArray[] = [];
	const structish: boolean[] = [];
	let segment = "";
	let segmentLine = 1;
	let line = 1;
	for (const char of text) {
		if (char === "\n") {
			line++;
			segment += char;
		} else if (char === "{") {
			structish.push(/\b(struct|union|enum)\b/.test(segment));
			segment = "";
			segmentLine = line;
		} else if (char === "}") {
			structish.pop();
			segment = "";
			segmentLine = line;
		} else if (char === ";") {
			if (structish.length > 0 && !structish.includes(true)) {
				const entry = declaration(file, segmentLine, segment);
				if (entry) found.push(entry);
			}
			segment = "";
			segmentLine = line;
		} else {
			segment += char;
		}
	}
	return found;
}

/** Every local array in the unit, one entry per declaration. */
export function unitArrays(): LocalArray[] {
	return SHIM_PART_NAMES.flatMap((name) => localArrays(name, readShimPart(name)));
}

/** The entries the rule forbids, as printable lines: at or above the limit, or unmeasurable. */
export function offences(entries: LocalArray[]): string[] {
	return entries
		.filter((entry) => entry.bytes === undefined || entry.bytes >= FRAME_LIMIT)
		.map((entry) => `${entry.file}:${entry.line} ${entry.text} = ${entry.bytes} bytes`);
}
