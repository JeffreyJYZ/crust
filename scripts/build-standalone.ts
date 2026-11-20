#!/usr/bin/env bun
/**
 * Build crust as one standalone executable and prove it works with no checkout: `bun build --compile --asset` embeds the templates and `src/` tree that `dev` and `build` materialise at runtime, and the checks run the binary from a bare environment and an unrelated directory.
 *
 * `--target bun-<os>-<arch>` compiles for another platform, which is what a release needs: one machine per OS emits that OS's binaries. The assets are embedded either way, but a binary for another OS cannot be *executed* here, so the version/init/doctor half is host-only and says so instead of pretending. `--expect-version v0.1.22` is the release's own assertion: the tag must name `package.json`'s version, which is what the binary embeds and what `--version` prints.
 */
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { supportsAot } from "../src/packaging/aot.ts";
import { proveStandalone } from "./release/standalone-prove.ts";
import { artifactName, hostTarget, TARGETS, type Target, VERSION } from "./release/targets.ts";

const root = resolve(import.meta.dir, "..");
const outdir = join(root, "dist");

/** Everything crust reads from its own package at runtime. */
const ASSETS = ["src", "templates", "tsconfig.json", "package.json"] as const;

/** Scaffold file counts the binary must write; `init.test.ts` reads these exact literals. */
const SCAFFOLD_COUNTS = [
	["--next", 8],
	["--react", 6],
	["--svelte", 7],
	["--vue", 7],
	["--solid", 9],
	["", 6],
] as const;

let failures = 0;

function pass(label: string, detail: string): void {
	console.log(`  PASS  ${label.padEnd(18)}${detail}`);
}

function fail(label: string, detail: string): void {
	failures++;
	console.log(`  FAIL  ${label.padEnd(18)}${detail}`);
}

function die(message: string): never {
	console.error(`build-standalone: ${message}`);
	process.exit(2);
}

/** The host's own target — the only one whose binary can be executed on this machine. */
function requireHost(): Target {
	const host = hostTarget();
	if (host === undefined) die(`no release target for ${process.platform}-${process.arch}`);
	return host;
}

/** `--target` picks another OS/arch; absent means the host, so the script behaves as before. */
function readTarget(argv: string[]): Target | undefined {
	const index = argv.indexOf("--target");
	if (index < 0) return undefined;
	const value = argv[index + 1];
	const known = Object.keys(TARGETS).join(", ");
	if (!value || value.startsWith("--")) die(`--target needs a value: ${known}`);
	if (!(value in TARGETS)) die(`unknown target ${value}: ${known}`);
	return value as Target;
}

/** The version is never written here: it is `package.json`'s, and a tag that disagrees fails. */
function assertExpectedVersion(argv: string[]): void {
	const index = argv.indexOf("--expect-version");
	if (index < 0) return;
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) die("--expect-version needs a value, e.g. v0.1.22");
	const version = value.startsWith("v") ? value.slice(1) : value;
	if (version !== VERSION) die(`the tag says ${value}, but package.json says ${VERSION}`);
	pass("tag", `${value} is package.json ${VERSION}`);
}

async function main(): Promise<void> {
	const argv = Bun.argv.slice(2);
	const requested = readTarget(argv);
	const host = requireHost();
	const target = requested ?? host;

	// With `--target` the output is a release artefact; without it, the local `dist/crust`
	// path every other script and the CI step already know.
	const outfile = requested
		? join(outdir, artifactName(target))
		: join(outdir, `crust${TARGETS[host].os === "windows" ? ".exe" : ""}`);

	assertExpectedVersion(argv);

	const compile = Bun.spawnSync(
		[
			"bun",
			"build",
			"--compile",
			// Free on stable 1.4.4 (byte-identical), a size win on toolchains that implement AOT.
			...(supportsAot() ? ["--aot"] : []),
			...(requested ? [`--target=${target}`] : []),
			"--outfile",
			outfile,
			"src/cli/index.ts",
			...ASSETS.map((asset) => `--asset=${asset}`),
		],
		{ cwd: root, stdio: ["inherit", "inherit", "inherit"] },
	);
	if (compile.exitCode !== 0) {
		fail("compile", `bun build --compile exited ${compile.exitCode} for ${target}`);
		return;
	}

	const { size } = await stat(outfile);
	pass("compile", `${outfile}  ${size.toLocaleString()} bytes  ${target}`);

	if (target === host) {
		await proveStandalone(outfile, { pass, fail }, SCAFFOLD_COUNTS);
	} else {
		// Honest, not silent: the assets are embedded and the container is for `target`,
		// but this machine cannot run it, so nothing here claims the binary works.
		console.log(
			`  SKIP  run-and-prove      ${target} cannot run on ${host}: version/init/doctor are host-only`,
		);
	}

	const note = target === host ? "" : `  (compiled for ${target}; not run here)`;
	console.log(
		failures === 0
			? `\nstandalone: PASS  ${outfile}${note}`
			: `\nstandalone: FAIL  ${failures} check(s)`,
	);
	if (failures > 0) process.exit(1);
}

await main();
