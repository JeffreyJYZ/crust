import { existsSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { listAssets } from "./assets.ts";
import { crustRoot, fail, line, type CliOptions } from "./util.ts";

/** The scaffold sources. Copied, never assembled from strings in this file. */
const TEMPLATES = {
	vanilla: "templates/default",
	react: "templates/react",
	next: "templates/next",
	svelte: "templates/svelte",
	vue: "templates/vue",
} as const;

type TemplateName = keyof typeof TEMPLATES;
type Framework = Exclude<TemplateName, "vanilla">;

/** The flags init accepts, in the order errors name them. */
const FRAMEWORKS = ["react", "next", "svelte", "vue"] as const satisfies readonly Framework[];

/** `--react`, `--next`, `--svelte`, `--vue` and the scaffolds they copy. */
const DESCRIPTION: Record<Framework, string> = {
	react: "React + Vite",
	next: "Next.js with a static export",
	svelte: "Svelte + Vite",
	vue: "Vue + Vite",
};

/** `crust init` options: the shared CLI options plus the template flags. */
export interface InitOptions extends CliOptions {
	/** `--react`: copy the React + Vite template. */
	react?: boolean;
	/** `--next`: copy the Next.js static-export template. */
	next?: boolean;
	/** `--svelte`: copy the Svelte + Vite template. */
	svelte?: boolean;
	/** `--vue`: copy the Vue + Vite template. */
	vue?: boolean;
}

const VITE_HINT = "bun run build          (vite build → dist/web, then crust build → dist/)";

/** The one line that follows a template, printed under `next:`. */
const BUILD_HINT: Partial<Record<TemplateName, string>> = {
	react: VITE_HINT,
	next: "bun run build          (next build → out/, then crust build → dist/)",
	svelte: VITE_HINT,
	vue: VITE_HINT,
};

/** A directory name become a package name: lowercase, dots and dashes kept. */
function packageName(raw: string): string {
	const slug = raw
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "");
	return slug.length > 0 ? slug : "crust-app";
}

/**
 * `crust init [dir] [--react | --next | --svelte | --vue]` — copy a template into an empty directory. The templates ship as real files rather than string literals, so a user can read what they will get and this command has nothing to keep in sync; the crust installation running `init` is pinned as `link:`, which makes `bun install && bunx crust dev` work from a checkout.
 * No flag is `templates/default/` (plain HTML, no bundler); `--react`, `--svelte` and `--vue` are Vite apps into `dist/web/`, `--next` is Next's app router with `output: "export"` into `out/`. Two flags at once are refused naming each, and a non-empty directory is refused rather than merged — silently overwriting someone's `public/index.html` is worse than stopping.
 */
export async function init(options: InitOptions): Promise<number> {
	const chosen = FRAMEWORKS.filter((flag) => options[flag] === true);
	if (chosen.length > 1) {
		return fail(
			"init",
			`${chosen.map((flag) => `--${flag}`).join(", ")} choose different scaffolds — pass one: ` +
				chosen.map((flag) => `--${flag} is ${DESCRIPTION[flag]}`).join(", "),
		);
	}

	const target = resolve(options.dir);
	const templateName: TemplateName = chosen[0] ?? "vanilla";

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

	const template = await listAssets(TEMPLATES[templateName]).catch(() => undefined);
	if (!template || template.length === 0) {
		return fail(
			"init",
			`the crust installation has no ${TEMPLATES[templateName]} — expected ` +
				`${resolve(crustRoot, TEMPLATES[templateName])} on disk, or the same path embedded ` +
				"with --asset. The package was installed without its templates/ directory",
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
		// A checkout pins the live directory; anything else (a `bunx` run, a
		// registry install) has to name the package, because the directory it is
		// running from is a cache path that will not survive.
		"{{crust_dep}}": crustDep(crustRoot, existsSync(join(crustRoot, ".git"))),
	};

	console.log(`crust init — ${target}`);
	line("template", `${TEMPLATES[templateName]}/`);
	const created: string[] = [];
	for (const asset of template) {
		// npm renames a nested `.gitignore` to `.npmignore` when packing, so the
		// template keeps it under a plain name and it is renamed on copy.
		const destination = asset.relative === "gitignore" ? ".gitignore" : asset.relative;
		const bytes = await asset.bytes();
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

/**
 * The dependency specifier a scaffold pins the crust package to. A checkout
 * links the live directory; a registry/bunx run names the package instead.
 * Bun resolves forward slashes on Windows, so a native `C:\a\crust` root is
 * normalised to `C:/a/crust` before substitution: raw `\a` and `\c` are not
 * valid JSON escapes and would make the scaffold's package.json unparseable.
 * A checkout's `link:` still resolves to one realpath, the invariant
 * `framework.ts:22` relies on to keep CLI and project on one module instance.
 */
export function crustDep(root: string, isCheckout: boolean): string {
	return isCheckout ? `link:${root.replaceAll("\\", "/")}` : "github:JeffreyJYZ/crust";
}

/** Replace the template tokens in a UTF-8 file. Binary files never reach this. */
function applyTokens(bytes: Uint8Array, tokens: Record<string, string>): string {
	let text = Buffer.from(bytes).toString("utf8");
	for (const [token, value] of Object.entries(tokens)) {
		text = text.replaceAll(token, value);
	}
	return text;
}
