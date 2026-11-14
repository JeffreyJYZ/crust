/**
 * What must travel and what must not: the templates `crust init` copies, the
 * docs it points at, the directories an install never needs, and any `@/` import
 * the package must resolve by itself.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { filesUnder, ROOT, type Stage, usesAlias } from "../context.ts";

export async function checkTravel(stage: Stage): Promise<void> {
	const { check, listing, pkgRoot, shipped } = stage;

	// ---- templates ----------------------------------------------------
	// The checkout supplies the expected file list; the tarball must contain
	// every one of them, because `crust init` copies real files and a missing
	// template is a failed scaffold rather than a degraded one.
	for (const name of ["default", "react", "next"]) {
		const expected = await filesUnder(join(ROOT, "templates", name));
		const missing = expected.filter((path) => !shipped(`templates/${name}/${path}`));
		check(
			`templates/${name} travels with its files`,
			expected.length > 0 && missing.length === 0,
			`${missing.length} of ${expected.length} missing: ${missing.join(", ")}`,
			`${expected.length} files`,
		);
	}

	// ---- docs ---------------------------------------------------------
	// The documentation is a site under `site/`, with its own dependencies and build
	// output, so it is a repository artefact rather than part of what an install
	// receives. What a user gets, and what an editor opens, is README.md.
	check("README.md travels in the tarball", shipped("README.md"), "README.md missing");

	// ---- what must not travel -----------------------------------------
	for (const prefix of [
		"research/",
		"examples/",
		"spike/",
		"site/",
		"node_modules/",
		".crust/",
		".git/",
	]) {
		const leaked = [...listing].filter((path) => path.startsWith(prefix));
		check(
			`${prefix.replace(/\/$/, "")}/ is not shipped`,
			leaked.length === 0,
			`${leaked.length} file(s), first ${leaked[0]}`,
		);
	}

	// ---- checkout-only specifiers -------------------------------------
	// A bare `@/x` import resolves through tsconfig `paths`, which is not in
	// `files`. If the source uses it and no shipped config defines it, the
	// installed package cannot load that module — on any machine, for everyone.
	const sources = [...listing].filter((path) => /\.(ts|tsx)$/.test(path));
	const aliased: string[] = [];
	for (const path of sources) {
		const source = await readFile(join(pkgRoot, path), "utf8").catch(() => "");
		if (usesAlias(source)) aliased.push(path);
	}
	let aliasDefined = false;
	for (const config of ["tsconfig.json", "jsconfig.json"]) {
		if (!shipped(config)) continue;
		const text = await readFile(join(pkgRoot, config), "utf8").catch(() => "");
		const match = text.match(/"paths"\s*:/);
		if (match) aliasDefined = true;
	}
	check(
		'no "@/" import is left unresolved by the package itself',
		aliased.length === 0 || aliasDefined,
		`${aliased.length} of ${sources.length} shipped source files import "@/" but the tarball ships no tsconfig "paths" (first: ${aliased[0]})`,
		aliased.length === 0
			? "no alias imports"
			: `${aliased.length} of ${sources.length} files import "@/", and the shipped tsconfig defines "paths"`,
	);
}
