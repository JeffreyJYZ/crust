/**
 * The frontmatter the `skills` CLI requires before it will install `SKILL.md`.
 *
 * `scripts/skill.ts --check` runs this so the requirement is enforced here rather than discovered
 * by a user whose install attempt reports `missing required frontmatter field(s): name, description`
 * and then `No skills found` — that failure shipped silently once, with every gate green.
 *
 * The rules are the CLI's, not ours: both fields present and non-empty strings, the name shaped
 * like a skill directory (`lowercase letters, digits, "."`, "_" and "-"`, and no traversal), and the
 * description short enough to load (1024 characters). The frontmatter must also be the first bytes
 * of the file — a BOM, a blank line or a heading above it means the parser never sees a block.
 */

/** `name` as the CLI and the skill directories spell it: lowercase, digits, `.`, `_`, `-`. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** The description is what an agent loads before deciding, so the CLI caps it. */
export const MAX_DESCRIPTION = 1024;

export interface Frontmatter {
	name: string;
	description: string;
}

/** Strip a single layer of matching quotes, which YAML allows around a scalar. */
function scalar(raw: string): string {
	const value = raw.trim();
	if (value.length >= 2) {
		const first = value[0];
		if ((first === '"' || first === "'") && value.endsWith(first))
			return value.slice(1, -1);
	}
	return value;
}

/**
 * Read the leading `---` block, or `null` when the file does not open with one.
 * Only the flat `key: value` shape is understood: that is all a skill's frontmatter is.
 */
export function readFrontmatter(text: string): Record<string, string> | null {
	if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null;
	const lines = text.split(/\r?\n/);
	const close = lines.indexOf("---", 1);
	if (close < 0) return null;
	const data: Record<string, string> = {};
	for (const line of lines.slice(1, close)) {
		if (line.trim() === "" || line.startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const key = line.slice(0, colon).trim();
		if (key !== "") data[key] = scalar(line.slice(colon + 1));
	}
	return data;
}

/** Every reason the CLI would skip this file. An empty list means it installs. */
export function frontmatterProblems(text: string): string[] {
	const data = readFrontmatter(text);
	if (data === null) {
		return [
			"no YAML frontmatter: the file must open with `---` and close the block with `---`",
		];
	}

	const problems: string[] = [];
	const name = data.name ?? "";
	const description = data.description ?? "";

	if (name === "") problems.push("frontmatter `name` is missing or empty");
	else if (!NAME_PATTERN.test(name)) {
		problems.push(
			`frontmatter \`name\` "${name}" must be lowercase letters, digits, "." or "-"`,
		);
	}
	if (description === "")
		problems.push("frontmatter `description` is missing or empty");
	else if (description.length > MAX_DESCRIPTION) {
		problems.push(
			`frontmatter \`description\` is ${description.length} characters, over ${MAX_DESCRIPTION}`,
		);
	}
	return problems;
}
