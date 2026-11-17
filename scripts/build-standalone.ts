#!/usr/bin/env bun
/**
 * Build crust as one standalone executable and prove it works with no checkout: `bun build --compile --asset` embeds the templates and `src/` tree that `dev` and `build` materialise at runtime, and the checks run the binary from a bare environment and an unrelated directory.
 *
 * `--target bun-<os>-<arch>` compiles for another platform, which is what a release needs: one machine per OS emits that OS's binaries. The assets are embedded either way, but a binary for another OS cannot be *executed* here, so the version/init/doctor half is host-only and says so instead of pretending. `--expect-version v0.1.22` is the release's own assertion: the tag must name `package.json`'s version, which is what the binary embeds and what `--version` prints.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { artifactName, hostTarget, TARGETS, type Target, VERSION } from "./release/targets.ts";

const root = resolve(import.meta.dir, "..");
const outdir = join(root, "dist");

/** Everything crust reads from its own package at runtime. */
const ASSETS = ["src", "templates", "tsconfig.json", "package.json"] as const;

/** The bare environment a user's machine has, so nothing leaks in from this one. */
const BARE_ENV = {
	PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
};

/**
 * The doctor lines this platform's binary must satisfy. `doctor` is a macOS command today:
 * `platform`, `shim` and `window` refuse every other OS by design (`doctor/environment.ts`
 * prints `macOS only — this is linux`), so elsewhere `templates` is the only claim a binary
 * can meet — and the one that proves the templates are inside the executable.
 */
const DOCTOR_CHECKS: readonly string[] =
	process.platform === "darwin" ? ["shim", "templates", "window", "platform"] : ["templates"];

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

/** Drive the compiled binary the way a user does. Only possible for the host's own target. */
async function prove(outfile: string): Promise<void> {
	// 1. It starts, and knows its version with no package.json beside it.
	const version = Bun.spawnSync([outfile, "--version"], { env: BARE_ENV });
	const printed = version.stdout.toString().trim();
	if (version.exitCode === 0 && printed === VERSION)
		pass("version", `${printed} with PATH=/usr/bin:/bin`);
	else
		fail(
			"version",
			`exited ${version.exitCode}, printed ${JSON.stringify(printed)}, wanted ${VERSION}`,
		);

	// 2. It scaffolds, which means the templates are inside the executable.
	const workspace = await mkdtemp(join(tmpdir(), "crust-standalone-"));
	try {
		for (const [flag, count] of [
			["--next", 8],
			["--react", 6],
			["", 6],
		] as const) {
			const name = `app${flag === "" ? "-plain" : flag}`;
			const target = join(workspace, name);
			const args = [outfile, "init", target, ...(flag === "" ? [] : [flag])];
			const init = Bun.spawnSync(args, { cwd: workspace, env: BARE_ENV });
			// The glob does not see dotfiles, so `.gitignore` is checked separately —
			// it is the file a scaffold is most likely to lose.
			const listed = [...new Bun.Glob("**/*").scanSync({ cwd: target, onlyFiles: true })];
			const ignore = Bun.file(join(target, ".gitignore")).size > 0;
			if (init.exitCode === 0 && listed.length === count && ignore)
				pass("init", `${flag || "(no flag)"} wrote ${listed.length + 1} files`);
			else
				fail(
					"init",
					`${flag || "(no flag)"} exited ${init.exitCode} with ${listed.length} files ` +
						`and .gitignore ${ignore ? "present" : "missing"}: ` +
						init.stderr.toString().trim().slice(0, 120),
				);
		}

		// 3. Doctor reaches the shim, the platform and the templates from inside the
		// binary. It is allowed to fail on the frontend checks — nothing is built yet.
		const scaffold = join(workspace, "app-next");
		const doctor = Bun.spawnSync([outfile, "doctor", "--dir", scaffold], {
			cwd: workspace,
			env: BARE_ENV,
		});
		const text = `${doctor.stdout.toString()}${doctor.stderr.toString()}`;
		for (const check of DOCTOR_CHECKS) {
			const line = text.split("\n").find((row) => row.trim().startsWith(check));
			if (line?.includes("[ok]")) pass(`doctor ${check}`, line.trim().slice(0, 80));
			else fail(`doctor ${check}`, line?.trim() ?? "no line printed");
		}
		// Said out loud, so a green line never implies doctor passed: on a non-macOS host it
		// exits 1 on those three checks and this binary is not the reason.
		const skipped = ["shim", "window", "platform"].filter(
			(check) => !DOCTOR_CHECKS.includes(check),
		);
		if (skipped.length > 0)
			console.log(
				`  SKIP  doctor            ${skipped.join(", ")} are macOS-only checks on ${process.platform}`,
			);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
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
		await prove(outfile);
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
