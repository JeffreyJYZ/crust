/**
 * The end-to-end proof for the shape most users will live in: `crust dev` on the
 * React + Vite scaffold.
 *
 * `e2e:dev` proves the watcher against `examples/hello`, whose page the bridge
 * serves itself. `e2e:single` proves one file. Neither touches the third shape:
 * `dev.url` set, so `crust dev` starts the frontend command itself, the runtime
 * hands that page its bridge address and token, and the window loads a document
 * another origin served. That is the shape with CORS, a cross-origin bearer
 * token, and an HMR client the framework does not own — and until now it rested
 * on one manual run.
 *
 * What each assertion is worth, and what would be a false pass:
 *
 *   - the served document is fetched from the dev server and must carry the Vite
 *     client, the `/src/main.tsx` module and the *live* `window.__CRUST__` pair
 *     from `.crust/dev.json`. A cached or stale page fails on the token, because
 *     that value is minted per launch and only this project's Vite can print it;
 *   - the bridge's own document is fetched too and must not contain the Vite
 *     client, so "the window loaded the dev page" is a comparison of two real
 *     documents rather than an inference;
 *   - `greet` in the runtime log is the page's own `invoke` arriving from the
 *     dev origin. It cannot be produced by the bridge's document: the React
 *     scaffold has no `public/`, so that document is the empty one;
 *   - the page is then edited and both halves are checked: the dev server must
 *     serve the new text, and the window must run it and answer again. Only the
 *     dev server can re-serve an edited module, so this is also the positive
 *     proof that the running page is the Vite one;
 *   - one `bridge` line and no `restart` line across the edit. A restart rotates
 *     the token and rebuilds the window, so a second line means the backend was
 *     restarted for a change the dev server owns.
 *
 * The blocks are ordered so each one stands alone: the dev server, the client it
 * serves, the bridge's own document, the cross-origin invoke and the whole stop
 * path are all provable without the window. Only "edit reload" needs a page that
 * is alive, so a dead window costs one failure rather than a skipped run.
 *
 * No warm-up, deliberately: the cold start is part of the proof. `crust dev` used
 * to hand the window its URL before `beforeDevCommand` was listening, and a cold
 * Vite (measured 0.66-1.08 s to first listen) lost that race silently — 0 of 4
 * fresh-scratch runs ever reached the page. `dev.ts` now waits for `dev.url` to
 * accept a connection before the runtime is spawned, so the un-warmed run is
 * what proves that fix instead of papering over it.
 *
 * The scaffold is built with `crust init <dir> --react` rather than by copying
 * `templates/react` here. Copying is the more fragile choice: it would have to
 * reproduce init's token map (`{{name_text}}` JSON-escaping, `{{package}}`
 * slugging, and the checkout-vs-registry choice for `{{crust_dep}}`), and a
 * fourth token added to the template would silently leave a literal `{{…}}` in
 * the scratch project. `init` is the code path a user runs, so the scaffold
 * under test can never drift from the scaffold users get.
 *
 * Usage:
 *   bun scripts/e2e-dev-react.ts    # or `bun run e2e:dev:react` once package.json names it
 *
 * The phases live in `dev-react/phases/` — scaffold, serve, edit, stop — and
 * `dev-react/fixture.ts` holds the pinned port, the runtime's lines and the
 * HTTP plumbing they read through.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, Verdict } from "./e2e-harness.ts";
import { spawnLive } from "./lib/live-run.ts";
import { CLI, GRACE_MS, REPO_ROOT } from "./dev-react/fixture.ts";
import { editPhase } from "./dev-react/phases/edit.ts";
import { scaffoldPhase } from "./dev-react/phases/scaffold.ts";
import { servePhase } from "./dev-react/phases/serve.ts";
import { stopPhase } from "./dev-react/phases/stop.ts";

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-dev-react: SKIP  this proof opens a macOS window and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-dev-react-"));
	try {
		return await proof(verdict, scratch);
	} finally {
		// The CLI (`dev --dir <scratch>`) and the runtime (`--config <scratch>/…`)
		// both name the scratch directory on their argv, so either is clearable by
		// path. The dev server does not — it runs as `bun --bun
		// ./node_modules/.bin/vite` with the project as its cwd — which is why the
		// survivor check also holds every child's pid: a `pgrep -f vite` would match
		// every Vite on the machine, and a bare path pattern would miss this one.
		await clearSurvivors(scratch).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function proof(verdict: Verdict, scratch: string): Promise<number> {
	if (!(await scaffoldPhase(verdict, scratch))) return verdict.report("e2e-dev-react");

	// ---- 3. No warm-up: the cold start is the point -----------------------
	// This used to run the dev server once and stop it, because `crust dev` created the
	// window before Vite listened and the page request went into a closed port. `dev` now
	// waits for the URL, so the fixture stays cold — pre-bundled dependencies would hide
	// exactly the race this file exists to catch.

	// ---- 4. `crust dev` starts the frontend, and the dev server answers ----
	const dev = spawnLive([CLI, "dev", "--dir", scratch], REPO_ROOT, { graceMs: GRACE_MS });
	try {
		const served = await servePhase(verdict, dev, scratch);
		await editPhase(verdict, dev, scratch, served.greeted);
		await stopPhase(verdict, dev, served.early, scratch);
	} finally {
		await dev.stop().catch(() => undefined);
	}

	return verdict.report("e2e-dev-react");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-dev-react: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
