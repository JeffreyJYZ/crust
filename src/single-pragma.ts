/**
 * The one `crust-security:` declaration a single file may carry. Only a real comment configures the
 * app: the same text printed inside `<pre>`, a block comment or a string is prose, and a page that
 * documents the pragma must not silently run under the policy it meant to illustrate.
 */

import type { SecurityConfig } from "@/config";

const SECURITY_PRAGMA = /^\s*(?:\/\/|<!--)\s*crust-security:\s*(\{[^\n]*\})\s*(?:-->)?\s*$/m;

const LITERAL_ELEMENT = /^<(pre|code|textarea)\b/i;
const QUOTE_PREFIX = /[=([{,:;!?&|+\-*/<>%]$/;

/** Blank the regions where a line that looks like a comment is only text; preserve offsets. */
function maskProse(source: string): string {
	const masked = source.split("");
	const blank = (from: number, to: number): void => {
		for (let at = from; at < to && at < masked.length; at++) {
			if (masked[at] !== "\n") masked[at] = " ";
		}
	};
	let index = 0;
	while (index < source.length) {
		const char = source[index]!;
		if (char === "/" && source[index + 1] === "*") {
			const start = index;
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				index++;
			}
			index = Math.min(index + 2, source.length);
			blank(start, index);
			continue;
		}
		if (char === "`" || char === "'" || char === '"') {
			// Quotes inside a comment are the JSON of the pragma itself; leave them intact.
			const lineStart = source.lastIndexOf("\n", index - 1) + 1;
			const lineHead = source.slice(lineStart, index).trimStart();
			if (lineHead.startsWith("//") || lineHead.startsWith("<!--")) {
				index++;
				continue;
			}
			const before = source.slice(0, index).trimEnd();
			// An apostrophe in JSX or HTML prose is not a string; a quote after code punctuation is.
			if (char !== "`" && before.length > 0 && !QUOTE_PREFIX.test(before)) {
				index++;
				continue;
			}
			const start = index++;
			while (index < source.length && source[index] !== char) {
				if (source[index] === "\\") index++;
				index++;
			}
			index = Math.min(index + 1, source.length);
			blank(start, index);
			continue;
		}
		if (char === "<" && !/[\w-]/.test(source[index - 1] ?? "")) {
			const element = LITERAL_ELEMENT.exec(source.slice(index));
			if (element !== null) {
				const openEnd = source.indexOf(">", index + element[0].length);
				if (openEnd >= 0) {
					const close = new RegExp(`</${element[1]}\\s*>`, "i").exec(
						source.slice(openEnd + 1),
					);
					const end =
						close === null
							? source.length
							: openEnd + 1 + close.index + close[0].length;
					blank(index, end);
					index = end;
					continue;
				}
			}
		}
		index++;
	}
	return masked.join("");
}

/** The declared `security`, or the reason the line is not usable. */
export function declaredSecurity(
	source: string,
	name: string,
): { security?: SecurityConfig } | { error: string } {
	const match = SECURITY_PRAGMA.exec(maskProse(source));
	if (match === null) return {};
	const literal = match[1] as string;
	try {
		const parsed: unknown = JSON.parse(literal);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("not a JSON object");
		}
		return { security: parsed as SecurityConfig };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			error:
				`crust-security in ${name} is not a one-line JSON object (${reason}) — ` +
				`write it as // crust-security: {"csp":"…","microphone":"…"}`,
		};
	}
}
