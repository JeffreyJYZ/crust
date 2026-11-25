/**
 * The install phase: `bun add <tarball>` into an empty project, then the real `crust --help`, every declared export, and `crust init probe --react`. `--help` is load-bearing: it imports every CLI module, so a specifier resolving only in this checkout fails here rather than in the user's first command.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../../src/packaging/exec.ts";
import { filesUnder, ROOT, type Stage } from "../context.ts";

export async function checkInstall(
	stage: Stage,
	workspace: string,
	tarball: string,
	declared: string[],
): Promise<void> {
	const { check } = stage;
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
	if (!cliStat) return;

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

	// Resolving is not the same as being usable: `perf` shipped in 0.2.14 with a working plugin that
	// `crust/plugin` did not re-export, so every plugin an app mounts is imported *and mounted* here, and
	// one command is called. A barrel that forgets an export fails this, and a plugin whose mount throws
	// fails it too.
	const mounted = await run(
		[
			"bun",
			"-e",
			[
				`const p = await import("crust/plugin");`,
				`const missing = ["createPerfPlugin"].filter((n) => typeof p[n] !== "function");`,
				`if (missing.length) { console.error("not exported: " + missing.join(",")); process.exit(1); }`,
				`const plugin = p.createPerfPlugin();`,
				`const answer = plugin.commands.sample();`,
				`if ("requires" in answer) { console.error("refused: " + answer.requires); process.exit(1); }`,
				`if (!("frame" in answer) || answer.frame !== null) { console.error("no null frame on a fresh mount"); process.exit(1); }`,
				`console.log("mounted");`,
			].join("\n"),
		],
		{ cwd: consumer },
	);
	check(
		"createPerfPlugin mounts from the installed package and perf.sample answers",
		mounted.code === 0 && /mounted/.test(mounted.stdout),
		(mounted.stderr.trim() || mounted.stdout.trim()).split("\n")[0] ?? `exit ${mounted.code}`,
	);

	// The overlay is page code behind its own subpath, and its two exports are what the docs an app
	// reads tell it to import. Resolution is checked above for every declared subpath; this asserts the
	// names, because a subpath that resolves to a module without `mountOverlay` is just as unusable.
	const overlayExport = await run(
		[
			"bun",
			"-e",
			[
				`const o = await import("crust/perf/overlay");`,
				`if (typeof o.mountOverlay !== "function") { console.error("mountOverlay is " + typeof o.mountOverlay); process.exit(1); }`,
				`if (typeof o.MARKER !== "string") { console.error("MARKER is " + typeof o.MARKER); process.exit(1); }`,
				`console.log("overlay-ok");`,
			].join("\n"),
		],
		{ cwd: consumer },
	);
	check(
		'crust/perf/overlay exports mountOverlay and MARKER',
		overlayExport.code === 0 && /overlay-ok/.test(overlayExport.stdout),
		(overlayExport.stderr.trim() || overlayExport.stdout.trim()).split("\n")[0] ??
			`exit ${overlayExport.code}`,
	);

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
	const expected = templateFiles.map((path) => (path === "gitignore" ? ".gitignore" : path));
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
