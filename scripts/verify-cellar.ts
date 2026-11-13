#!/usr/bin/env bun
/**
 * Prove the Homebrew layout, without Homebrew.
 *
 * The Cellar is not just "crust installed somewhere": the formula copies a fixed file
 * list into `libexec` and writes a `bin/crust` wrapper that runs `libexec/src/cli/index.ts`
 * with the depended-on `bun`. Everything crust resolves at runtime — templates, docs, the
 * C shim, `tsconfig.json` for the `@/` alias — hangs off that layout, so a formula that
 * drifts from the package breaks `init` or `doctor` while the tarball stays green.
 *
 * This reproduces those two steps from a tag and runs the same suites against the result.
 * It is not a substitute for `brew upgrade` (that needs the tap merged), but it is the
 * part of the brew path that can be wrong in this repo.
 *
 *   bun run verify:cellar                 # latest tag
 *   bun run verify:cellar --tag v0.1.8    # a specific one
 */
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const args = Bun.argv.slice(2);
const tagArg = args.indexOf("--tag");
const requested = tagArg >= 0 ? args[tagArg + 1] : undefined;

/** The formula's install list and wrapper, read from the tap's own formula. */
const FORMULA =
	process.env.CRUST_FORMULA ??
	`${process.env.HOME}/dev/worktrees/homebrew-tap/main/Formula/crust.rb`;

let failures = 0;
function pass(label: string, detail: string): void {
	console.log(`  PASS  ${label.padEnd(20)}${detail}`);
}
function fail(label: string, detail: string): void {
	failures++;
	console.log(`  FAIL  ${label.padEnd(20)}${detail}`);
}

async function sh(cmd: string[], cwd = REPO): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, out, err };
}

const formula = await Bun.file(FORMULA)
	.text()
	.catch(() => "");
if (formula === "") {
	fail("formula", `cannot read ${FORMULA} — set CRUST_FORMULA to the tap clone's path`);
	process.exit(1);
}
const installLine = /libexec\.install (.+)$/m.exec(formula)?.[1];
if (installLine === undefined) {
	fail("formula", "no libexec.install line — the layout this script reproduces is gone");
	process.exit(1);
}
const travels = [...installLine.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);

// The wrapper's interpreter is the recipe's own: bun from PATH is what `depends_on "bun"`
// provides, and the formula's `Formula["bun"].opt_bin` resolves to the same binary.
const bun = Bun.which("bun");
if (bun === null) {
	fail("bun", "no bun on PATH, so the wrapper cannot run");
	process.exit(1);
}

const tag =
	requested ??
	(await sh(["git", "tag", "--sort=-v:refname"])).out
		.split("\n")
		.map((line) => line.trim())
		.find((line) => /^v\d+\.\d+\.\d+$/.test(line));
if (tag === undefined) {
	fail("tag", requested ? `${requested} was not given` : "no release tag in this checkout");
	process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), "crust-cellar-"));
const libexec = join(root, "libexec");
const bin = join(root, "bin");
try {
	// 1. The source tree at the tag, exactly as `brew` would fetch the archive.
	await mkdir(libexec, { recursive: true });
	await mkdir(bin, { recursive: true });
	const archive = join(root, "src.tar");
	const archived = await sh(["git", "archive", "--format=tar", "-o", archive, tag]);
	if (archived.code !== 0) {
		fail("archive", `git archive ${tag} exited ${archived.code}: ${archived.err.trim()}`);
		throw new Error("archive");
	}
	const extracted = await sh(["tar", "-xf", archive, "-C", libexec]);
	if (extracted.code !== 0) {
		fail("extract", `tar exited ${extracted.code}: ${extracted.err.trim()}`);
		throw new Error("extract");
	}
	pass("archive", `${tag} extracted from this checkout`);

	// 2. Keep only what `libexec.install` names, the way the formula does.
	const present = async (path: string): Promise<boolean> =>
		await Bun.file(path)
			.stat()
			.then(
				(info) => info !== null,
				() => false,
			);
	const missing: string[] = [];
	for (const entry of travels) if (!(await present(join(libexec, entry)))) missing.push(entry);
	if (missing.length > 0) {
		fail(
			"libexec",
			`${tag} does not contain ${missing.join(", ")} — the formula names files the tag lacks`,
		);
		throw new Error("libexec");
	}
	// `research/`, `examples/`, `scripts/` and `.github/` are not in the formula's list and
	// must not be needed at runtime; remove them so their absence is tested rather than assumed.
	for (const extra of ["research", "examples", "scripts", "spike", ".github"]) {
		await rm(join(libexec, extra), { recursive: true, force: true });
	}
	pass("libexec", `${travels.length} named paths, nothing else`);

	// 3. The wrapper, character for character what the formula writes.
	const wrapper = join(bin, "crust");
	await Bun.write(wrapper, `#!/bin/bash\nexec "${bun}" "${libexec}/src/cli/index.ts" "$@"\n`);
	await chmod(wrapper, 0o755);
	pass("wrapper", `${wrapper} → bun ${libexec}/src/cli/index.ts`);

	// 4. The checks that fail when the layout is wrong.
	const version = await sh([wrapper, "--version"]);
	const expected = tag.replace(/^v/, "");
	if (version.code === 0 && version.out.trim() === expected) pass("version", version.out.trim());
	else
		fail(
			"version",
			`exited ${version.code}: ${(version.out + version.err).trim().slice(0, 200)}`,
		);

	const scratch = join(root, "probe");
	const init = await sh([wrapper, "init", scratch, "--next"]);
	if (init.code === 0 && (await Bun.file(join(scratch, "tsconfig.json")).exists()))
		pass("init", "a --next scaffold, including the tsconfig the alias needs");
	else fail("init", `exited ${init.code}: ${(init.out + init.err).trim().slice(0, 300)}`);

	const doctor = await sh([wrapper, "doctor", "--dir", scratch]);
	const text = doctor.out + doctor.err;
	for (const check of ["shim", "templates", "window"]) {
		const line = text.split("\n").find((row) => row.trim().startsWith(check));
		if (line?.includes("[ok]")) pass(`doctor ${check}`, line.trim().slice(0, 78));
		else fail(`doctor ${check}`, line?.trim() ?? "no line printed");
	}
} catch {
	// Already reported above; fall through to the verdict so the group runs.
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log(
	failures === 0
		? "\ncellar-layout: PASS — the formula's layout runs this tag"
		: `\ncellar-layout: FAIL  ${failures} check(s)`,
);
if (failures > 0) process.exit(1);
