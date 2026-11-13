import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { crustRoot, fail, line, type CliOptions } from "./util.ts";

/** The scaffold sources. Copied, never assembled from strings in this file. */
const TEMPLATES = {
	vanilla: "templates/default",
	react: "templates/react",
	next: "templates/next",
} as const;

type TemplateName = keyof typeof TEMPLATES;

/** `crust init` options: the shared CLI options plus the template flags. */
export interface InitOptions extends CliOptions {
	/** `--react`: copy the React + Vite template. */
	react?: boolean;
	/** `--next`: copy the Next.js static-export template. */
	next?: boolean;
}

/** The one line that follows a template, printed under `next:`. */
const BUILD_HINT: Partial<Record<TemplateName, string>> = {
	react: "bun run build          (vite build → dist/web, then crust build → dist/)",
	next: "bun run build          (next build → out/, then crust build → dist/)",
};

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
 * `crust init [dir] [--react | --next]` — copy a template into an empty directory.
 *
 * The template ships as real files rather than string literals so a user can
 * read exactly what they will get, and so this command has nothing to keep in
 * sync. The crust installation that runs `init` is pinned as a `link:`
 * dependency, which is what makes `bun install && bunx crust dev` work from a
 * checkout without publishing the package first.
 *
 * Three scaffolds, no flag being the default:
 *
 * - no flag — `templates/default/`, plain HTML with no bundler;
 * - `--react` — `templates/react/`, React + Vite into `dist/web/`;
 * - `--next` — `templates/next/`, Next.js on the app router with
 *   `output: "export"` into `out/`.
 *
 * The two flags name different scaffolds, so both at once is refused with a
 * message naming each rather than one quietly winning.
 *
 * A non-empty directory is refused rather than merged: a scaffold that silently
 * overwrites someone's `public/index.html` is worse than one that stops.
 */
export async function init(options: InitOptions): Promise<number> {
	if (options.react && options.next) {
		return fail(
			"init",
			"--react and --next choose different scaffolds — pass one: --react is React + " +
				"Vite, --next is Next.js with a static export",
		);
	}

	const target = resolve(options.dir);
	const templateName: TemplateName = options.next ? "next" : options.react ? "react" : "vanilla";
	const templateDir = resolve(crustRoot, TEMPLATES[templateName]);

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

	const template = await stat(templateDir).catch(() => undefined);
	if (!template?.isDirectory()) {
		return fail(
			"init",
			`the crust installation has no ${TEMPLATES[templateName]} (expected ${templateDir}) — ` +
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
		// A checkout pins the live directory; anything else (a `bunx` run, a
		// registry install) has to name the package, because the directory it is
		// running from is a cache path that will not survive.
		"{{crust_dep}}": existsSync(join(crustRoot, ".git"))
			? `link:${crustRoot}`
			: "github:JeffreyJYZ/crust",
	};

	console.log(`crust init — ${target}`);
	line("template", `${TEMPLATES[templateName]}/`);
	const files = await templateFiles(templateDir);
	const created: string[] = [];
	for (const relative of files) {
		// npm renames a nested `.gitignore` to `.npmignore` when packing, so the
		// template keeps it under a plain name and it is renamed on copy.
		const destination = relative === "gitignore" ? ".gitignore" : relative;
		const source = join(templateDir, relative);
		const bytes = await readFile(source);
		const out = join(target, destination);
		await Bun.write(out, bytes.includes(0) ? bytes : Buffer.from(applyTokens(bytes, tokens)));
		created.push(destination);
	}

	for (const file of created) line("created", file);
	const steps = ["", "next:", `  cd ${target}`, "  bun install", "  bunx crust dev"];
	const hint = BUILD_HINT[templateName];
	if (hint) steps.push(`  ${hint}`);
	console.log(`${steps.join("\n")}\n`);
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
