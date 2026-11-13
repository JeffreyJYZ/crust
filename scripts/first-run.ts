#!/usr/bin/env bun
/**
 * What a stranger does, from nothing: scaffold, install, build, run.
 *
 * Every other script here tests one layer. This one tests the chain a newcomer actually
 * walks, and it is the only check that would notice a scaffold that installs but does
 * not build, or a build that produces an app whose window never answers.
 *
 *   bun run verify:first-run                  # the CLI on PATH, React template
 *   bun run verify:first-run --next           # the Next template
 *   bun run verify:first-run --crust ./dist/crust --plain
 *
 * Needs the network for the scaffold's own dependencies, so it is not in CI.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = Bun.argv.slice(2);
const template = argv.includes("--next") ? "next" : argv.includes("--plain") ? "plain" : "react";
const crustIndex = argv.indexOf("--crust");
const crust = crustIndex >= 0 ? (argv[crustIndex + 1] ?? "crust") : "crust";

let failures = 0;

function pass(label: string, detail: string): void {
	console.log(`  PASS  ${label.padEnd(14)}${detail}`);
}

function fail(label: string, detail: string): void {
	failures++;
	console.log(`  FAIL  ${label.padEnd(14)}${detail}`);
}

/** Run a command to completion, echoing its tail on failure. */
async function run(
	label: string,
	cmd: string[],
	cwd: string,
): Promise<{ ok: boolean; output: string }> {
	const spawned = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(spawned.stdout).text(),
		new Response(spawned.stderr).text(),
		spawned.exited,
	]);
	const output = `${out}${err}`;
	if (code === 0) pass(label, `${cmd.join(" ")} — exit 0`);
	else fail(label, `${cmd.join(" ")} — exit ${code}\n${output.slice(-600)}`);
	return { ok: code === 0, output };
}

/**
 * Launch the built binary the way the e2e suites do: directly, never through `open`,
 * with a deadline, and a SIGTERM to the whole group so no helper survives.
 */
async function launch(binary: string, deadlineMs: number): Promise<{ code: number; log: string }> {
	const spawned = Bun.spawn([binary], {
		cwd: "/",
		stdout: "pipe",
		stderr: "pipe",
	});
	const chunks: string[] = [];
	const reader = (async () => {
		for await (const chunk of spawned.stdout) chunks.push(new TextDecoder().decode(chunk));
	})();
	const deadline = Date.now() + deadlineMs;
	while (Date.now() < deadline) {
		const text = chunks.join("");
		if (text.includes("page call answered")) break;
		await Bun.sleep(100);
	}
	try {
		process.kill(-spawned.pid, "SIGTERM");
	} catch {
		spawned.kill("SIGTERM");
	}
	const code = await spawned.exited;
	await reader;
	return { code, log: chunks.join("") };
}

const workspace = await mkdtemp(join(tmpdir(), "crust-first-run-"));
const app = join(workspace, "app");

try {
	const init = [crust, "init", app, ...(template === "plain" ? [] : [`--${template}`])];
	const scaffold = await run("scaffold", init, workspace);
	if (!scaffold.ok) throw new Error("scaffold failed");

	const installed = await run("install", ["bun", "install"], app);
	if (!installed.ok) throw new Error("install failed");

	const built = await run("build", [crust, "build"], app);
	if (!built.ok) throw new Error("build failed");

	const bundle = await Array.fromAsync(
		new Bun.Glob("dist/*.app").scan({ cwd: app, onlyFiles: false }),
	);
	if (bundle.length !== 1) fail("bundle", `${bundle.length} bundles in dist/: ${bundle.join(", ")}`);
	else pass("bundle", bundle[0]!);

	const binary = bundle[0]
		? await Array.fromAsync(
				new Bun.Glob("Contents/MacOS/*").scan({ cwd: join(app, bundle[0]), onlyFiles: true }),
			).then((entries) => entries[0] && join(app, bundle[0]!, entries[0]))
		: undefined;

	if (!binary) {
		fail("binary", "no executable inside the bundle");
	} else {
		const info = await stat(binary);
		pass("binary", `${binary}  ${info.size.toLocaleString()} bytes`);
		const launched = await launch(binary, 20_000);
		const answered = launched.log.includes("page call answered");
		if (launched.code === 0 && answered)
			pass("window", launched.log.split("\n").find((row) => row.includes("page call answered"))?.trim() ?? "");
		else fail("window", `exit ${launched.code}, answered ${answered}\n${launched.log.slice(-600)}`);
	}
} catch (error) {
	fail("chain", error instanceof Error ? error.message : String(error));
} finally {
	await rm(workspace, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nfirst-run: PASS" : `\nfirst-run: FAIL  ${failures} step(s)`);
if (failures > 0) process.exit(1);
