/**
 * Assert what `bun add crust` actually delivers.
 *
 * Every other check in this repo reads the working tree, so all of them pass on
 * a package that is broken the moment it is installed: `files` decides which
 * bytes travel, `bin` names a file that may not exist, and `exports` maps
 * specifiers to paths that may not resolve once the checkout's `tsconfig.json`
 * is left behind. This script answers that question from the tarball alone.
 *
 * Three phases, in the order a user meets them:
 *
 *   pack     `bun pm pack` into a temp dir, so `files` is the only input.
 *   unpack   read the received copy: manifest, bin target, exports, templates,
 *            docs, and the directories that must NOT travel.
 *   install  `bun add <tarball>` into an empty project, then run the real
 *            `crust --help` and `crust init probe --react` there.
 *
 * A passing `--help` is the load-bearing check: it imports every CLI module, so
 * a specifier that only resolves inside this checkout fails here instead of in
 * the user's first command line.
 *
 * Usage:
 *   bun scripts/verify-package.ts            # pack, verify, clean up
 *   bun scripts/verify-package.ts --keep     # leave the workspace on disk
 *
 * Deliberately cheap and offline: the tarball is installed by path, crust has
 * no runtime dependencies, and nothing here publishes anything.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatBytes } from "../src/packaging/build";
import { run } from "../src/packaging/exec";

const ROOT = resolve(import.meta.dir, "..");

/** One reason the received package is not what the checkout promises. */
interface Gap {
	what: string;
	detail: string;
}

/** Every file under `dir`, as `/`-separated relative paths. */
async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const files: string[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const path = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await filesUnder(join(dir, entry.name), path)));
		} else if (entry.isFile()) {
			files.push(path);
		}
	}
	return files;
}

/** `@/x` style specifiers only resolve while the checkout's tsconfig is present. */
function usesAlias(source: string): boolean {
	return /\bfrom\s+"@\/|\bfrom\s+'@\//.test(source) || /\bimport\s*\(\s*["']@\//.test(source);
}

async function main(): Promise<number> {
	const keep = process.argv.includes("--keep");
	const gaps: Gap[] = [];
	let checks = 0;

	/**
	 * Record and report one assertion, in the order a user would meet it.
	 *
	 * `gap` is what a failure means; it is printed only when the check fails, so
	 * a passing line never reads as a complaint. `found` is the passing detail,
	 * where a count or a path is the evidence.
	 */
	const check = (what: string, ok: boolean, gap = "", found = ""): void => {
		checks++;
		if (ok) {
			console.log(`  PASS  ${what}${found.length > 0 ? `  ${found}` : ""}`);
			return;
		}
		gaps.push({ what, detail: gap });
		console.log(`  FAIL  ${what}${gap.length > 0 ? `  ${gap}` : ""}`);
	};

	const workspace = await mkdtemp(join(tmpdir(), "crust-verify-package-"));
	try {
		// ---- pack ---------------------------------------------------------
		const packDir = join(workspace, "pack");
		await mkdir(packDir, { recursive: true });
		const packed = await run(["bun", "pm", "pack", "--destination", packDir, "--quiet"], {
			cwd: ROOT,
		});
		if (packed.code !== 0) {
			console.log(`verify-package: FAIL  bun pm pack exited ${packed.code}`);
			console.log(`  ${(packed.stderr.trim() || packed.stdout.trim()).split("\n")[0]}`);
			return 1;
		}
		const tarball = packed.stdout.trim().split("\n").pop() ?? "";
		const tarballStat = await stat(tarball).catch(() => undefined);
		if (!tarballStat?.isFile()) {
			console.log(`verify-package: FAIL  bun pm pack printed no tarball (${tarball})`);
			return 1;
		}
		console.log(`  pack  ${tarball}  ${formatBytes(tarballStat.size)}`);

		// ---- unpack -------------------------------------------------------
		const unpackDir = join(workspace, "unpacked");
		await mkdir(unpackDir, { recursive: true });
		const extracted = await run(["tar", "-xzf", tarball, "-C", unpackDir]);
		if (extracted.code !== 0) {
			console.log(`verify-package: FAIL  tar -xzf exited ${extracted.code}`);
			console.log(`  ${extracted.stderr.trim().split("\n")[0]}`);
			return 1;
		}
		const pkgRoot = join(unpackDir, "package");

		// The listing is the whole truth about what travelled: every assertion
		// below reads this set (or a file under `pkgRoot`), never the checkout.
		const listing = new Set(await filesUnder(pkgRoot));
		const shipped = (path: string): boolean => listing.has(path);

		const manifestRaw = await readFile(join(pkgRoot, "package.json"), "utf8").catch(() => "");
		let manifest: Record<string, unknown> = {};
		try {
			manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
		} catch {
			// Reported below as the first missing fact; every later assertion on
			// the manifest would only repeat it.
		}
		const checkout = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as Record<
			string,
			unknown
		>;

		check(
			"package.json is a parseable manifest named crust",
			manifest.name === checkout.name,
			`name ${JSON.stringify(manifest.name)} is not ${JSON.stringify(checkout.name)}`,
			`name ${manifest.name} version ${manifest.version}`,
		);

		// ---- bin ----------------------------------------------------------
		const bin = (manifest.bin ?? {}) as Record<string, string>;
		const binPath = typeof bin.crust === "string" ? bin.crust.replace(/^\.\//, "") : "";
		check("bin names src/cli/index.ts", binPath === "src/cli/index.ts", `got "${binPath}"`);
		check("bin target travels in the tarball", shipped(binPath), `${binPath} missing`, binPath);

		const binStat =
			binPath.length > 0
				? await stat(join(pkgRoot, binPath)).catch(() => undefined)
				: undefined;
		const binMode = (binStat?.mode ?? 0) & 0o777;
		check(
			"bin target is executable as a script",
			binStat?.isFile() === true && (binMode & 0o111) !== 0,
			`mode ${binMode.toString(8)} has no execute bit`,
			`mode ${binMode.toString(8)}`,
		);

		const binSource =
			binPath.length > 0
				? await readFile(join(pkgRoot, binPath), "utf8").catch(() => "")
				: "";
		const binHead = binSource.split("\n")[0] ?? "";
		check(
			"bin target starts with a bun shebang",
			binHead === "#!/usr/bin/env bun",
			`first line ${JSON.stringify(binHead)}`,
		);

		// ---- exports ------------------------------------------------------
		const exportsMap = (manifest.exports ?? {}) as Record<string, string>;
		const declared = Object.keys(exportsMap);
		check(
			"exports declares ., ./plugin and ./vite",
			[".", "./plugin", "./vite"].every((key) => declared.includes(key)),
			declared.join(" "),
		);
		for (const [key, target] of Object.entries(exportsMap)) {
			const path = typeof target === "string" ? target.replace(/^\.\//, "") : "";
			check(
				`exports "${key}" target exists`,
				path.length > 0 && shipped(path),
				`${path || JSON.stringify(target)} missing`,
				path,
			);
		}

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
		// `crust init` vends a text instruction to open the docs, so the docs are
		// part of what was received, not part of the repo's own furniture.
		const docs = (await filesUnder(join(ROOT, "docs"))).filter((path) => path.endsWith(".md"));
		const missingDocs = docs.filter((path) => !shipped(`docs/${path}`));
		check(
			"docs/*.md travel in the tarball",
			docs.length > 0 && missingDocs.length === 0,
			`${missingDocs.length} of ${docs.length} missing: ${missingDocs.join(", ")}`,
			`${docs.length} files`,
		);
		check("DESIGN.md travels in the tarball", shipped("DESIGN.md"), "DESIGN.md missing");
		check("README.md travels in the tarball", shipped("README.md"), "README.md missing");

		// ---- what must not travel -----------------------------------------
		for (const prefix of [
			"research/",
			"examples/",
			"spike/",
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
			`no alias imports across ${sources.length} source files`,
		);

		// ---- install ------------------------------------------------------
		const consumer = join(workspace, "consumer");
		await mkdir(consumer, { recursive: true });
		await Bun.write(
			join(consumer, "package.json"),
			`${JSON.stringify({ name: "crust-probe", private: true, type: "module" }, null, "\t")}\n`,
		);
		const added = await run(["bun", "add", tarball], { cwd: consumer });
		check(
			"bun add <tarball> succeeds",
			added.code === 0,
			(added.stderr.trim() || added.stdout.trim()).split("\n")[0] ?? `exit ${added.code}`,
		);

		const cli = join(consumer, "node_modules", ".bin", "crust");
		const cliStat = await stat(cli).catch(() => undefined);
		check(
			"node_modules/.bin/crust exists",
			cliStat !== undefined,
			`${cli} missing — the manifest's bin was not linked`,
		);
		if (cliStat) {
			const help = await run([cli, "--help"], { cwd: consumer });
			check(
				"crust --help runs from the installed package",
				help.code === 0 && /usage:/.test(help.stdout),
				(help.stderr.trim() || help.stdout.trim()).split("\n")[0] ?? `exit ${help.code}`,
			);

			for (const spec of declared) {
				const name = spec === "." ? "crust" : `crust/${spec.replace(/^\.\//, "")}`;
				const imported = await run(["bun", "-e", `await import(${JSON.stringify(name)})`], {
					cwd: consumer,
				});
				check(
					`import "${name}" resolves from the installed package`,
					imported.code === 0,
					(imported.stderr.trim() || imported.stdout.trim()).split("\n")[0] ??
						`exit ${imported.code}`,
				);
			}

			// `crust init` is the first command a user runs, and it reads the
			// templates through `crustRoot` — so this proves the templates were
			// found at their installed path, not only that they exist in a tarball.
			const scaffold = await run([cli, "init", "probe", "--react"], { cwd: consumer });
			check(
				"crust init probe --react runs from the installed package",
				scaffold.code === 0,
				(scaffold.stderr.trim() || scaffold.stdout.trim()).split("\n")[0] ??
					`exit ${scaffold.code}`,
			);

			const probe = join(consumer, "probe");
			const templateFiles = await filesUnder(join(ROOT, "templates", "react"));
			const expected = templateFiles.map((path) =>
				path === "gitignore" ? ".gitignore" : path,
			);
			const written = await filesUnder(probe);
			const unwritten = expected.filter((path) => !written.includes(path));
			check(
				"the scaffold contains every React template file",
				scaffold.code === 0 && unwritten.length === 0,
				`${unwritten.length} of ${expected.length} unwritten: ${unwritten.join(", ")}`,
				`${written.length} files`,
			);
			check(
				"the scaffold has no unrenamed gitignore",
				!written.includes("gitignore"),
				"gitignore left unrenamed",
			);
			if (!templateFiles.includes("gitignore")) {
				console.log(
					"  note  templates/react ships no gitignore, so the scaffold has none — " +
						"an app scaffolded with --react commits node_modules and dist",
				);
			}

			const probeManifest = (await Bun.file(join(probe, "package.json"))
				.json()
				.catch(() => ({}))) as { dependencies?: Record<string, string> };
			const pinned = probeManifest.dependencies?.crust;
			// A `link:` into a cache path is the failure this looks for: it works
			// until the cache is pruned, then the scaffold cannot install.
			const cachePin =
				typeof pinned === "string" &&
				(pinned.startsWith("link:") || pinned.startsWith("file:")) &&
				pinned.slice(5).includes("/node_modules/");
			check(
				"the scaffold pins crust to something durable",
				typeof pinned === "string" && pinned.length > 0 && !cachePin,
				`dependencies.crust = ${JSON.stringify(pinned)}`,
				pinned,
			);
			if (typeof pinned === "string" && pinned.length > 0) {
				console.log(`  note  the scaffold installs crust from ${JSON.stringify(pinned)}`);
			}
		}

		// ---- verdict ------------------------------------------------------
		const verdict = gaps.length === 0 ? "PASS" : "FAIL";
		const summary =
			gaps.length === 0 ? `${checks} check(s)` : `${gaps.length} of ${checks} check(s)`;
		console.log(
			`verify-package: ${verdict}  ${summary}  tarball ${formatBytes(tarballStat.size)}`,
		);
		if (keep) console.log(`  kept  ${workspace}`);
		return gaps.length === 0 ? 0 : 1;
	} finally {
		if (!keep) await rm(workspace, { recursive: true, force: true });
	}
}

try {
	process.exit(await main());
} catch (error) {
	// An unreadable tarball is still a verdict, not a stack trace.
	console.log(`verify-package: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
