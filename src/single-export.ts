/**
 * The default-export shape test for a single file. Textual by design: detection
 * runs before the bundle, without a parser dependency. Comments and string or
 * template contents are blanked first, so a code sample printed by a
 * side-effect page cannot masquerade as an export — while a real `export
 * default` after a semicolon on one line is still seen.
 */

/** Blank comments and string/template contents, keeping newlines and code. */
function codeOnly(source: string): string {
	let out = "";
	let index = 0;
	const end = source.length;
	while (index < end) {
		const char = source[index]!;
		if (char === "/" && source[index + 1] === "/") {
			while (index < end && source[index] !== "\n") {
				out += " ";
				index++;
			}
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			out += "  ";
			index += 2;
			while (index < end && !(source[index] === "*" && source[index + 1] === "/")) {
				out += source[index] === "\n" ? "\n" : " ";
				index++;
			}
			if (index < end) {
				out += "  ";
				index += 2;
			}
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			const quote = char;
			out += " ";
			index++;
			while (index < end && source[index] !== quote) {
				if (source[index] === "\\") {
					out += " ";
					index++;
					if (index < end) {
						out += source[index] === "\n" ? "\n" : " ";
						index++;
					}
					continue;
				}
				out += source[index] === "\n" ? "\n" : " ";
				index++;
			}
			if (index < end) {
				out += " ";
				index++;
			}
			continue;
		}
		out += char;
		index++;
	}
	return out;
}

/** Whether a runtime default export exists, ignoring strings and comments. */
export function hasDefaultExport(source: string): boolean {
	const code = codeOnly(source);
	return (
		/(?:^|[;}\s])export\s+(?!type\b)default\b/.test(code) ||
		/(?:^|[;}\s])export\s*(?!type\b)\{[^}]*\bas\s+default\b[^}]*\}/.test(code)
	);
}
