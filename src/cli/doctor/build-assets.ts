/**
 * What a build would embed, and whether the scaffolding that `crust init`
 * copies is even in this install.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CrustConfig } from "@/config";
import { listAssets } from "../assets.ts";
import { crustRoot, exists } from "../util.ts";
import type { Check } from "./check.ts";

/**
 * What `crust build` would embed, decided without compiling anything.
 *
 * A named `build.assets` is a promise of an `index.html`; a missing or stale
 * directory is why a built app opens on a blank page, so it fails here with the
 * path and the command that produces it. When the setting is absent the old
 * `public/` rule stands — except for a project that runs `beforeBuildCommand`
 * and has no `public/index.html`, where crust would silently embed nothing.
 */
export async function checkAssets(dir: string, config: CrustConfig): Promise<Check> {
	const setting = config.build?.assets;
	const command = config.build?.beforeBuildCommand;
	const hint = command ? `\`${command}\`` : "`bun x vite build`";
	const outDir = resolve(dir, "dist");

	if (setting !== undefined) {
		const assetsDir = resolve(dir, setting);
		if (assetsDir === outDir) {
			return {
				name: "assets",
				status: "fail",
				detail:
					`build.assets "${setting}" is ${outDir}, where crust build writes its own output — ` +
					"point it at the frontend's directory (for Vite, dist/web)",
			};
		}
		if (!(await exists(assetsDir, "dir"))) {
			return {
				name: "assets",
				status: "fail",
				detail:
					`build.assets "${setting}" (${assetsDir}) is missing — run the frontend build (${hint}) ` +
					"then crust build; a build now embeds no page",
			};
		}
		if (!(await exists(join(assetsDir, "index.html")))) {
			return {
				name: "assets",
				status: "fail",
				detail:
					`build.assets "${setting}" (${assetsDir}) holds no index.html — the frontend build ` +
					`produced nothing there; run it (${hint}) then crust build`,
			};
		}
		return {
			name: "assets",
			status: "ok",
			detail:
				`"${setting}" at ${assetsDir} has index.html` +
				(command ? ` (beforeBuildCommand ${hint} is not run by doctor)` : ""),
		};
	}

	if (await exists(join(dir, "public", "index.html"))) {
		return { name: "assets", status: "ok", detail: `${resolve(dir, "public")} has index.html` };
	}
	if (command) {
		return {
			name: "assets",
			status: "fail",
			detail:
				`build.beforeBuildCommand ${hint} is set but build.assets is not and public/index.html is ` +
				"missing — crust would embed nothing; set build.assets to the directory it writes (e.g. dist/web)",
		};
	}
	return {
		name: "assets",
		status: "note",
		detail: `no build.assets and no public/index.html — a backend-only app ships with no page`,
	};
}

const TEMPLATES = ["default", "react", "next"] as const;

/**
 * The scaffolds ship inside the package, so a tarball without `templates/`
 * breaks `crust init` for every template. Nothing else reads them until init
 * runs, which is why this is checked here rather than left to that error.
 */
export async function checkTemplates(root = crustRoot): Promise<Check> {
	const missing: string[] = [];
	let embedded = 0;
	for (const name of TEMPLATES) {
		// `root` is honoured for fixtures; only the real package root falls back to
		// what a compiled executable carries.
		let count: number;
		if (root === crustRoot) {
			const assets = await listAssets(`templates/${name}`).catch(() => []);
			count = assets.length;
			if (count > 0 && !(await exists(resolve(root, "templates", name), "dir"))) embedded++;
		} else {
			const entries = await readdir(resolve(root, "templates", name), {
				withFileTypes: true,
			}).catch(() => []);
			count = entries.length;
		}
		if (count === 0) missing.push(name);
	}
	if (missing.length > 0) {
		return {
			name: "templates",
			status: "fail",
			detail:
				`${missing.map((name) => `templates/${name}`).join(", ")} missing from this install ` +
				`(${resolve(root, "templates")}, and not embedded) — reinstall crust; ` +
				"crust init cannot scaffold without them",
		};
	}
	const where =
		embedded > 0
			? `this executable holds ${TEMPLATES.join(", ")} (embedded with --asset)`
			: `${resolve(root, "templates")} holds ${TEMPLATES.join(", ")}`;
	return { name: "templates", status: "ok", detail: where };
}
