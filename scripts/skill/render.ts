/**
 * Render the registry as the markdown command table. One entry per namespace: the namespace name
 * followed by its commands, word-wrapped to a sane width. Nothing else — the heading and all prose
 * are owned by the human side of SKILL.md.
 */
import type { Namespace } from "./registry.ts";

/** Width used for the generated table, in characters. */
export const WRAP_WIDTH = 100;

/** Continuation indent for a wrapped `- ` list item: two spaces align with its content. */
const CONTINUATION = "  ";

/** Greedy word wrap. The first line is the bullet; wrapped lines carry the continuation indent. */
function wrap(text: string, width: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (line === "") line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else {
			lines.push(line);
			line = CONTINUATION + word;
		}
	}
	if (line !== "") lines.push(line);
	return lines;
}

/**
 * Build the table. Each namespace is one markdown list item; a long command list wraps under it.
 * The returned string ends with a single newline.
 */
export function render(namespaces: readonly Namespace[], width = WRAP_WIDTH): string {
	const lines: string[] = [];
	for (const ns of namespaces) {
		const item = ns.commands.length === 0
			? `- \`${ns.name}\` — (no commands)`
			: `- \`${ns.name}\` — ${ns.commands.join(" ")}`;
		lines.push(...wrap(item, width));
	}
	return `${lines.join("\n")}\n`;
}
