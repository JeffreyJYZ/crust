/**
 * Phase 4: `crust dev` starts the frontend, the dev server answers, the bridge
 * publishes its pair, and the page the window runs is the Vite one.
 *
 * The blocks are ordered so each stands alone: the dev server, the client it
 * serves, the bridge's own document, the cross-origin invoke and the whole stop
 * path are all provable without the window. Only "edit reload" needs a page that
 * is alive, so a dead window costs one failure rather than a skipped run.
 */
import { join } from "node:path";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import type { LiveRun, Proc } from "../../lib/live-run.ts";
import { lastLine, skip } from "../../lib/text.ts";
import {
	DEV_ORIGIN,
	GREET,
	get,
	PAIR_TIMEOUT_MS,
	poll,
	pollHandshake,
	REPO_ROOT,
	START_TIMEOUT_MS,
	STEP_TIMEOUT_MS,
	windowEvidence,
} from "../fixture.ts";

/** What the serve phase hands on: its tree capture, and whether a page answered. */
export interface Served {
	early: Proc[];
	greeted: boolean;
}

/** Returns the child tree captured while both children are known to exist. */
export async function servePhase(verdict: Verdict, dev: LiveRun, scratch: string): Promise<Served> {
	const isVite = (body: string): boolean =>
		body.includes("/@vite/client") &&
		body.includes('src="/src/main.tsx"') &&
		body.includes('id="root"');
	const servedBody = await poll(`${DEV_ORIGIN}/`, isVite, START_TIMEOUT_MS);
	verdict.check(
		"dev serve",
		servedBody !== null,
		servedBody !== null
			? `${DEV_ORIGIN}/ served the Vite client and the /src/main.tsx module`
			: `${DEV_ORIGIN}/ never served the Vite document within ${START_TIMEOUT_MS / 1000} s — ` +
					(lastLine(dev.text("out")) ||
						lastLine(dev.text("err")) ||
						"crust dev printed nothing"),
	);

	// Captured while both children are known to exist: the dev server is
	// answering and the runtime has published its bridge. The tree is not
	// assumed to last — a window that never loads makes `crust dev` stop itself
	// once the backend exits — so the survivor check uses this set as well.
	const early = await dev.tree();

	// The pair the runtime published for the dev server to read per request.
	// Polled: the frontend is spawned first and the bridge after it.
	const pair = await pollHandshake(join(scratch, ".crust", "dev.json"), PAIR_TIMEOUT_MS);
	if (pair === null) {
		skip(
			verdict,
			["crust client", "bridge document", "cross-origin invoke"],
			"not checked — the runtime never published a bridge pair in .crust/dev.json",
		);
	} else {
		// Fetched now that the pair exists: `crust/vite` reads dev.json per
		// document, so this is the page the window is given.
		const carriesPair = (body: string): boolean =>
			body.includes("window.__CRUST__") &&
			body.includes(`"url":"${pair.url}"`) &&
			body.includes(`"token":"${pair.token}"`);
		const page = await poll(`${DEV_ORIGIN}/`, carriesPair, STEP_TIMEOUT_MS);
		verdict.check(
			"crust client",
			page !== null,
			page !== null
				? `window.__CRUST__ carries ${pair.url} and this launch's token`
				: (servedBody?.includes("window.__CRUST__") ?? false)
					? "the page's window.__CRUST__ is not the pair the runtime published"
					: "the page has no window.__CRUST__ — crust/vite injected nothing",
		);

		// The counter-evidence: the bridge's own document is not the page. Without
		// this, "the window loaded the dev server" would rest on the greet line
		// alone, and a bridge-served page could account for it.
		const own = await get(`${pair.url}/`);
		const notVite = own !== null && own.status === 200 && !own.body.includes("/@vite/client");
		verdict.check(
			"bridge document",
			notVite,
			own === null
				? `${pair.url}/ refused the connection`
				: own.status !== 200
					? `${pair.url}/ answered ${own.status}`
					: notVite
						? `${pair.url}/ serves its own document, not the Vite client — ` +
							"the window's page can only be the dev server's"
						: "the bridge served the Vite document, so a greet line would prove nothing",
		);

		// The same round trip from the dev origin with the launch bearer token, so
		// a page failure and a CORS/token failure cannot be confused. curl, because
		// an independent client is what makes "another origin is allowed" a claim.
		const invoke = await runCommand(
			[
				"curl",
				"-sS",
				"-X",
				"POST",
				`${pair.url}/_crust/invoke`,
				"-H",
				`Origin: ${DEV_ORIGIN}`,
				"-H",
				`Authorization: Bearer ${pair.token}`,
				"-H",
				"content-type: application/json",
				"--data",
				JSON.stringify({
					plugin: "app",
					command: "invoke",
					args: { name: "greet", args: { name: "curl" } },
				}),
			],
			REPO_ROOT,
		);
		const answeredCurl = invoke.code === 0 && invoke.stdout.includes("hello curl");
		verdict.check(
			"cross-origin invoke",
			answeredCurl,
			answeredCurl
				? `a POST from ${DEV_ORIGIN} with the launch token answered "hello curl"`
				: `invoke from ${DEV_ORIGIN} answered ${lastLine(invoke.stdout) || lastLine(invoke.stderr) || "nothing"}`,
		);
	}

	// ---- 4. The window runs the page the dev server served --------------
	// This is the assertion the dev shape has never had. The page's own
	// `invoke("greet")` is the only thing that can print this line, and only a
	// page whose module came from Vite calls it with the scaffold's argument.
	const answered = await dev.wait("out", GREET, 1, START_TIMEOUT_MS);
	verdict.check(
		"window greet",
		answered !== null,
		answered ?? windowEvidence(dev.text("out"), dev.alive()),
	);

	return { early, greeted: answered !== null };
}
