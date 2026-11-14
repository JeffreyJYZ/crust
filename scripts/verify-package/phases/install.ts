/**
 * The install phase: `bun add <tarball>` into an empty project, then the real
 * `crust --help`, every declared export, and `crust init probe --react` there.
 *
 * A passing `--help` is the load-bearing check: it imports every CLI module, so
 * a specifier that only resolves inside this checkout fails here instead of in
 * the user's first command line.
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
