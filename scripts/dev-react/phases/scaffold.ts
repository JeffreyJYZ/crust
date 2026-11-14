/**
 * Phase 0-2: the port is the scaffold's and it is free, `crust init --react`
 * wrote what a user gets, and its dependencies installed with this checkout
 * linked as the framework.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine, skip } from "../../lib/text.ts";
import { CLI, DEV_ORIGIN, DEV_PORT, exists, listeners, REPO_ROOT } from "../fixture.ts";

/** `false` means the run stops here: every later assertion is unknowable. */
export async function scaffoldPhase(verdict: Verdict, scratch: string): Promise<boolean> {
	// ---- 0. The port is the scaffold's, and it is free ---------------------
	// A Vite already on 5173 would make every fetch below pass against someone
	// else's project. `strictPort` makes Vite refuse rather than move, so the
	// honest failure here is "this machine cannot run this proof", said loudly.
	const busy = await listeners(DEV_PORT);
	if (busy.length > 0) {
		verdict.check(
			"port free",
			false,
			`${DEV_ORIGIN} is already listening (pid ${busy.join(", ")}) — ` +
				"the scaffold pins that port with strictPort, so this run is refused " +
				"rather than moved to another one",
		);
		return false;
	}
	verdict.check("port free", true, `${DEV_ORIGIN} is free before the run`);

	// ---- 1. The scaffold a user gets --------------------------------------
	const init = await runCommand([CLI, "init", scratch, "--react"], REPO_ROOT);
	const files = ["crust.config.ts", "index.html", "main.ts", "vite.config.ts", "src/main.tsx"];
	const missing: string[] = [];
	for (const name of files) if (!(await exists(join(scratch, name)))) missing.push(name);
	const scaffolded = init.code === 0 && missing.length === 0;
	verdict.check(
		"scaffold",
		scaffolded,
		init.code !== 0
			? `crust init --react exited ${init.code} — ${lastLine(init.stderr) || lastLine(init.stdout)}`
			: missing.length === 0
				? `crust init --react wrote ${files.length} files`
				: `crust init exited 0 but did not write ${missing.join(", ")}`,
	);
	if (!scaffolded) {
		if (init.code !== 0) console.log(init.stdout + init.stderr);
		skip(verdict, ["deps"], "not checked — the scaffold was not written");
		return false;
	}

	// ---- 2. Its dependencies, including the linked framework --------------
	const install = await runCommand(["bun", "install"], scratch);
	const linked = await stat(join(scratch, "node_modules", "crust"))
		.then(() => true)
		.catch(() => false);
	const viteBin = await exists(join(scratch, "node_modules", "vite", "bin", "vite.js"));
	const deps = install.code === 0 && linked && viteBin;
	verdict.check(
		"deps",
		deps,
		install.code !== 0
			? `bun install exited ${install.code} — ${lastLine(install.stderr) || lastLine(install.stdout)}`
			: !linked
				? "node_modules/crust is missing — the scaffold cannot import the framework"
				: !viteBin
					? "node_modules/vite is missing — the frontend command could not start"
					: "bun install linked crust and installed vite",
	);
	return deps;
}
