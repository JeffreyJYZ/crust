import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { crustRoot, fail, line, type CliOptions } from "./util.ts";

/** The scaffold source. Copied, never assembled from strings in this file. */
const TEMPLATE_DIR = resolve(crustRoot, "templates/default");

/** A directory name become a package name: lowercase, dots and dashes kept. */
function packageName(raw: string): string {
	const slug = raw
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "");
	return slug.length > 0 ? slug : "crust-app";
}

/** Every file under `dir`, as `/`-separated relative paths. */
async function templateFiles(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await templateFiles(join(dir, entry.name), relative)));
		} else if (entry.isFile()) {
			files.push(relative);
		}
	}
	return files;
}

/**
 * `crust init [dir]` — copy `templates/default/` into an empty directory.
 *
 * The template ships as real files rather than string literals so a user can
 * read exactly what they will get, and so this command has nothing to keep in
 * sync. The crust installation that runs `init` is pinned as a `link:`
 * dependency, which is what makes `bun install && bunx crust dev` work from a
 * checkout without publishing the package first.
 *
 * A non-empty directory is refused rather than merged: a scaffold that silently
 * overwrites someone's `public/index.html` is worse than one that stops.
 */
export async function init(options: CliOptions): Promise<number> {
	const target = resolve(options.dir);

	const info = await stat(target).catch(() => undefined);
	if (info && !info.isDirectory()) {
		return fail("init", `${target} exists and is not a directory`);
	}
	if (info) {
		const entries = (await readdir(target)).filter((name) => name !== ".DS_Store");
		if (entries.length > 0) {
			const shown = entries.slice(0, 5).join(", ");
			const extra = entries.length > 5 ? `, +${entries.length - 5} more` : "";
			return fail(
				"init",
				`${target} is not empty (${entries.length} entr${entries.length === 1 ? "y" : "ies"}: ` +
					`${shown}${extra}) — crust init writes into an empty directory or a new one, ` +
					"so nothing of yours is overwritten",
			);
		}
	}

	const template = await stat(TEMPLATE_DIR).catch(() => undefined);
	if (!template?.isDirectory()) {
		return fail(
			"init",
			`the crust installation has no templates/default (expected ${TEMPLATE_DIR}) — ` +
				"the package was installed without its templates/ directory",
		);
	}

	const name = basename(target).length > 0 ? basename(target) : "crust app";
	const tokens: Record<string, string> = {
		// The TS/JS string body for a directory name: JSON.stringify escaped,
		// with its outer quotes stripped so the template stays valid TypeScript.
		"{{name_text}}": JSON.stringify(name).slice(1, -1),
		// The HTML form is the same name escaped for the document.
		"{{name_html}}": name
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;"),
		"{{package}}": packageName(name),
		"{{crust_root}}": crustRoot,
	};

	console.log(`crust init — ${target}`);
	const files = await templateFiles(TEMPLATE_DIR);
	const created: string[] = [];
	for (const relative of files) {
		// npm renames a nested `.gitignore` to `.npmignore` when packing, so the
		// template keeps it under a plain name and it is renamed on copy.
		const destination = relative === "gitignore" ? ".gitignore" : relative;
		const source = join(TEMPLATE_DIR, relative);
		const bytes = await readFile(source);
		const out = join(target, destination);
		await Bun.write(out, bytes.includes(0) ? bytes : Buffer.from(applyTokens(bytes, tokens)));
		created.push(destination);
	}

	for (const file of created) line("created", file);
	console.log(`\nnext:\n  cd ${target}\n  bun install\n  bunx crust dev\n`);
	return 0;
}

/** Replace the template tokens in a UTF-8 file. Binary files never reach this. */
function applyTokens(bytes: Uint8Array, tokens: Record<string, string>): string {
	let text = Buffer.from(bytes).toString("utf8");
	for (const [token, value] of Object.entries(tokens)) {
		text = text.replaceAll(token, value);
	}
	return text;
}
