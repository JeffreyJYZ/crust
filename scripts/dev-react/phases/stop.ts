/**
 * Phase 5 (second half): what `crust dev` owns, that all of it stops, and that
 * nothing is left behind.
 */
import { join } from "node:path";
import { survivorsOf, type Verdict } from "../../e2e-harness.ts";
import { type LiveRun, type Proc } from "../../lib/live-run.ts";
import { survivorsOfPids } from "../../lib/pids.ts";
import { REPO_ROOT } from "../fixture.ts";

export async function stopPhase(
	verdict: Verdict,
	dev: LiveRun,
	early: Proc[],
	scratch: string,
): Promise<void> {
	// The union of the tree seen while the run was up and the tree now: a
	// restart replaces the runtime child, so the earlier capture holds a pid that
	// is already gone and the later one holds a pid the earlier never saw. The
	// argv each pid was running under is what identifies the two children, so no
	// name is ever matched on its own.
	const late = await dev.tree();
	const seen = [...early, ...late];
	const owned = [...new Set(seen.map((proc) => proc.pid))];
	// The tree is already scoped to the `crust dev` process, so argv only has to say
	// which child is which. The dev command is relative (`bun --bun
	// ./node_modules/.bin/vite`), so it carries no scratch prefix to match.
	const vite = seen.find((proc) => proc.command.includes(".bin/vite"));
	// The runtime child comes from the project's own crust under `dev` (one module
	// instance with the app's `import "crust"`), or from this checkout when the
	// scaffold links to it. Both are accepted; a runtime outside both is a leak.
	const runtime = seen.find(
		(proc) =>
			proc.command.includes(join(scratch, "node_modules", "crust", "src", "runtime.ts")) ||
			proc.command.includes(join(REPO_ROOT, "src", "runtime.ts")),
	);
	// The template runs the dev server under Bun. If it went through the `.bin`
	// shebang instead, `node` would hold it — which is the bug this guards against.
	const viteUnderBun = vite !== undefined && !/\bnode\b/.test(vite.command.split(" ")[0] ?? "");
	verdict.check(
		"processes",
		vite !== undefined && runtime !== undefined && viteUnderBun,
		vite !== undefined && runtime !== undefined && viteUnderBun
			? `the tree held both children (${owned.length} pids seen), matched by argv: ` +
					`${vite.command.replace(scratch, "<scratch>")}`
			: vite !== undefined && !viteUnderBun
				? `the dev server is running under node, not Bun: ${vite.command} — the template's ` +
					"`bun --bun` is not reaching the runtime, so a machine whose node cannot run " +
					"the tool would fail here"
				: `the child tree is missing ${vite === undefined ? "the dev server" : "the runtime"} — ` +
					(seen
						.map((proc) => `${proc.pid}: ${proc.command || "<no argv>"}`)
						.join(" | ") || "no children"),
	);

	const code = await dev.stop();
	verdict.check(
		"exit 0",
		code === 0,
		code === 0
			? "crust dev exited 0 on SIGTERM to the process group"
			: `crust dev exited ${code ?? "null"} instead of stopping cleanly`,
	);

	// Identity first (each captured child must be gone), then argv (anything
	// naming this project, which also catches a respawn). Never a bare name:
	// `pgrep -f vite` would answer with every Vite on the machine.
	const byPid = await survivorsOfPids([dev.pid, ...owned]);
	const byPath = byPid.length === 0 ? await survivorsOf(scratch) : [];
	const left = [...new Set([...byPid, ...byPath])];
	verdict.check(
		"no survivors",
		left.length === 0,
		left.length === 0
			? `no process remains: ${owned.length} children signalled, nothing names the scratch path`
			: `still running: pid ${left.join(", ")}`,
	);
}
