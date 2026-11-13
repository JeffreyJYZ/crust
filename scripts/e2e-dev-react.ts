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
 */

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
// CRUST_BIN lets the same suite judge a *shipped* crust — an installed tarball or a
// compiled binary — rather than this checkout. Default is the checkout.
const CLI = process.env.CRUST_BIN ?? join(REPO_ROOT, "src/cli/index.ts");

/**
 * The port and origin the scaffold pins. `vite.config.ts` sets `strictPort: true`
 * on purpose — the bridge allowlists exactly the origin `dev.url` names, so a
 * Vite that quietly moved to the next free port would produce a page whose every
 * invoke is a CORS refusal. A test that accepted "some port" would pass while
 * that happened.
 */
const DEV_PORT = 5173;
const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;

/** The page's answer for the value the scaffold ships (`{ name: "react" }`). */
const GREET = /greet\s+hello react \(page call answered\)/;
/** The runtime was restarted instead of the page being reloaded — phase 4 forbids it. */
const RESTARTED = /restart\s+backend changed/;
/** The runtime printing the address it serves, and the origin it expects the page from. */
const BRIDGE = /bridge\s+http:\/\/127\.0\.0\.1:\d+\s+\(page from http:\/\/localhost:5173\)/;

/** Vite's cold start, the shim compile and WebKit's web process. Measured ~2 s. */
const START_TIMEOUT_MS = 45_000;
/** One save, Vite's HMR reload and the page's answer. Measured < 1 s. */
const STEP_TIMEOUT_MS = 20_000;
/** The runtime's bridge pair, published after the frontend was spawned. Measured < 2 s. */
const PAIR_TIMEOUT_MS = 30_000;
/**
 * How long a restart can take to show itself. `crust dev` debounces a backend
 * change by 150 ms, then kills the runtime and spawns another that prints its own
 * bridge line, so "no restart" cannot be judged at the instant the page reloads.
 */
const RESTART_SETTLE_MS = 2500;
/** How long a signalled process gets before SIGKILL. */
const GRACE_MS = 8000;

/** The text the edit puts in the page; it must reach the served module. */
const MARKER = "edited";
/** Exactly what the scaffold's `src/main.tsx` passes to `invoke`. */
const ARGUMENT = '{ name: "react" }';

type Stream = "out" | "err";

function delay(ms: number): Promise<"delay"> {
	return new Promise((resolve) => setTimeout(() => resolve("delay"), ms));
}

/** The last non-empty line of a captured stream, for a failure detail. */
function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/**
 * Why the page never answered, in one line.
 *
 * Two facts decide it and both are in the runtime's own output: whether a window
 * was created at all, and whether it was created before the dev server printed
 * its ready banner. The second is the failure this shape has — `loadRequest:` is
 * issued once, so a window that navigates before the frontend is listening has
 * nothing to connect to, and the page never runs.
 */
function windowEvidence(out: string, running: boolean): string {
	const opened = /window\s+open/.exec(out);
	const vite = /VITE v/.exec(out);
	const ended = running ? "" : ` — crust dev had already exited: ${lastLine(out) || "no output"}`;
	if (!opened)
		return `no greet answer within ${START_TIMEOUT_MS / 1000} s — the window never opened${ended}`;
	if (!vite)
		return (
			`no greet answer within ${START_TIMEOUT_MS / 1000} s — the window opened and the ` +
			`dev server never reported ready${ended}`
		);
	const order =
		opened.index < vite.index
			? "before the dev server reported ready — its one document request had nothing " +
				"to connect to, so the page never ran"
			: "after the dev server was ready and the page still never ran";
	return `no greet answer within ${START_TIMEOUT_MS / 1000} s — the window opened ${order}${ended}`;
}

/** Mark every listed assertion failed when an earlier step made them unknowable. */
function skip(verdict: Verdict, names: string[], why: string): void {
	for (const name of names) verdict.check(name, false, why);
}

/** Every match of `pattern` in `text`, for "one bridge line, not two" checks. */
function count(text: string, pattern: RegExp): number {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

/** Signal the child's process group, falling back to the child alone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
		return;
	} catch {
		// No group (already gone, or not a leader); aim at the child itself.
	}
	try {
		process.kill(pid, signal);
	} catch {
		// Nothing left to signal.
	}
}

/** Whether a pid is still in the process table. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** A pid that is still running after `settleMs`, or an empty list. */
async function survivors(pids: readonly number[], settleMs = 2000): Promise<number[]> {
	const deadline = performance.now() + settleMs;
	for (;;) {
		const left = pids.filter(alive);
		if (left.length === 0 || performance.now() >= deadline) return left;
		await delay(50);
	}
}

/** PIDs listening on `port`, via lsof. Exit 1 means none, which is what we want. */
async function listeners(port: number): Promise<number[]> {
	const { stdout } = await runCommand(
		["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
		REPO_ROOT,
	);
	return stdout
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** A live child's whole output, kept so several lines can be waited for. */
interface LiveRun {
	readonly pid: number;
	text(stream: Stream): string;
	wait(stream: Stream, pattern: RegExp, which: number, timeoutMs: number): Promise<string | null>;
	alive(): boolean;
	/**
	 * Every descendant right now, with the argv it was running under.
	 *
	 * pid and argv are read together because a restart replaces the runtime child:
	 * a pid captured earlier is gone by the time a separate `ps` gets to it, and
	 * the argv of the child that answered is the evidence this proof needs.
	 */
	tree(): Promise<Proc[]>;
	/** SIGTERM the group, then SIGKILL after the grace period. Idempotent. */
	stop(): Promise<number | null>;
}

/** One descendant: which pid, and the command line it was started with. */
interface Proc {
	pid: number;
	command: string;
}

/**
 * Spawn a process that has to stay up across an edit.
 *
 * `e2e-harness.ts`'s `probe` stops the child the moment its proving line
 * appears, which is the right shape for one answer and the wrong one here: the
 * second half of this proof compares the same process before and after a save.
 * `e2e-single.ts` keeps its own copy for the same reason, and the shared harness
 * is not this script's to widen.
 *
 * The child is its own process group (`detached`), because `crust dev` owns a
 * runtime child *and* a frontend child: signalling only the CLI would leave a
 * window and a dev server behind while reporting success.
 */
function spawnLive(command: string[], cwd: string): LiveRun {
	const child = Bun.spawn({
		cmd: command,
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});

	const streams: Record<Stream, string> = { out: "", err: "" };
	let code: number | null = null;
	let settled = false;

	const exited = child.exited.then((status) => {
		settled = true;
		code = status;
		return status;
	});
	exited.catch(() => undefined);

	// One decoder per stream: a chunk boundary can split a character, and sharing
	// one decoder across two interleaved streams would corrupt both.
	const outDecoder = new TextDecoder();
	void (async () => {
		for await (const chunk of child.stdout)
			streams.out += outDecoder.decode(chunk, { stream: true });
	})().catch(() => undefined);
	const errDecoder = new TextDecoder();
	void (async () => {
		for await (const chunk of child.stderr)
			streams.err += errDecoder.decode(chunk, { stream: true });
	})().catch(() => undefined);

	const text = (stream: Stream): string => streams[stream];

	function lineOf(source: string, pattern: RegExp, which: number): string | null {
		const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
		const found = [...source.matchAll(new RegExp(pattern.source, flags))][which - 1];
		if (!found || found.index === undefined) return null;
		const start = source.lastIndexOf("\n", found.index) + 1;
		const end = source.indexOf("\n", found.index);
		return source.slice(start, end === -1 ? undefined : end).trim();
	}

	async function wait(
		stream: Stream,
		pattern: RegExp,
		which: number,
		timeoutMs: number,
	): Promise<string | null> {
		const deadline = performance.now() + timeoutMs;
		for (;;) {
			const found = lineOf(streams[stream], pattern, which);
			if (found !== null) return found;
			// A child that exited will never print the line; report that now rather
			// than burning the whole deadline on a process that is already gone.
			if (settled || performance.now() >= deadline) return null;
			await delay(100);
		}
	}

	/** pgrep exits 1 when a pid has no children; that is an empty answer. */
	async function childrenOf(pid: number): Promise<number[]> {
		const { stdout } = await runCommand(["pgrep", "-P", String(pid)], cwd);
		return stdout
			.split("\n")
			.map((line) => Number.parseInt(line.trim(), 10))
			.filter((child) => Number.isInteger(child) && child > 0);
	}

	async function descendants(): Promise<number[]> {
		const seen: number[] = [];
		const queue = [child.pid];
		while (queue.length > 0) {
			const pid = queue.shift();
			if (pid === undefined) break;
			for (const next of await childrenOf(pid)) {
				if (seen.includes(next)) continue;
				seen.push(next);
				queue.push(next);
			}
		}
		return seen;
	}

	async function commandOf(pid: number): Promise<string> {
		const { stdout } = await runCommand(["ps", "-o", "command=", "-p", String(pid)], cwd);
		return stdout.trim();
	}

	async function tree(): Promise<Proc[]> {
		const records: Proc[] = [];
		for (const pid of await descendants()) {
			let command = await commandOf(pid);
			// A child can leave between the `pgrep` walk and this `ps`; one retry
			// separates "it went away" from "it never had an argv".
			if (command.length === 0) {
				await delay(50);
				command = await commandOf(pid);
			}
			records.push({ pid, command });
		}
		return records;
	}

	let stopping: Promise<number | null> | undefined;
	async function stop(): Promise<number | null> {
		signalGroup(child.pid, "SIGTERM");
		await Promise.race([exited, delay(GRACE_MS)]);
		if (!settled) {
			// Still alive after the grace period: it answers no SIGTERM.
			signalGroup(child.pid, "SIGKILL");
			await Promise.race([exited, delay(2000)]);
		}
		return code;
	}

	return {
		pid: child.pid,
		text,
		wait,
		alive: () => alive(child.pid),
		tree,
		stop: () => {
			stopping ??= stop();
			return stopping;
		},
	};
}

/** The bridge pair the runtime published for the dev server to read per request. */
interface Handshake {
	url: string;
	token: string;
}

async function handshake(path: string): Promise<Handshake | null> {
	const text = await readFile(path, "utf8").catch(() => "");
	try {
		const parsed = JSON.parse(text) as { url?: unknown; token?: unknown };
		if (typeof parsed.url !== "string" || typeof parsed.token !== "string") return null;
		if (parsed.url.length === 0 || parsed.token.length === 0) return null;
		return { url: parsed.url, token: parsed.token };
	} catch {
		return null;
	}
}

/** Poll for the bridge pair: the frontend is spawned first and the bridge after it. */
async function pollHandshake(path: string, timeoutMs: number): Promise<Handshake | null> {
	const deadline = performance.now() + timeoutMs;
	for (;;) {
		const pair = await handshake(path);
		if (pair !== null) return pair;
		if (performance.now() >= deadline) return null;
		await delay(150);
	}
}

/** One GET, as text plus status; a refused connection is not an exception here. */
async function get(url: string): Promise<{ status: number; body: string } | null> {
	try {
		const response = await fetch(url);
		return { status: response.status, body: await response.text() };
	} catch {
		return null;
	}
}

/** Poll `url` until its body satisfies `done`, or the deadline passes. */
async function poll(
	url: string,
	done: (body: string) => boolean,
	timeoutMs: number,
): Promise<string | null> {
	const deadline = performance.now() + timeoutMs;
	for (;;) {
		const page = await get(url);
		if (page !== null && page.status === 200 && done(page.body)) return page.body;
		if (performance.now() >= deadline) return null;
		await delay(150);
	}
}

async function exists(path: string): Promise<boolean> {
	return stat(path)
		.then((entry) => entry.isFile())
		.catch(() => false);
}

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
		return verdict.report("e2e-dev-react");
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
		return verdict.report("e2e-dev-react");
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
	if (!deps) return verdict.report("e2e-dev-react");

	// ---- 3. No warm-up: the cold start is the point -----------------------
	// This used to run the dev server once and stop it, because `crust dev` created the
	// window before Vite listened and the page request went into a closed port. `dev` now
	// waits for the URL, so the fixture stays cold — pre-bundled dependencies would hide
	// exactly the race this file exists to catch.

	// ---- 4. `crust dev` starts the frontend, and the dev server answers ----
	// The order of the blocks below is deliberate: the dev server, the client it
	// serves, the bridge's own document and the stop path are each provable
	// without the window, so a dead window leaves one clear failure instead of
	// eleven "not checked" lines. Only "edit reload" truly needs a live page.
	const dev = spawnLive([CLI, "dev", "--dir", scratch], REPO_ROOT);
	try {
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
			const notVite =
				own !== null && own.status === 200 && !own.body.includes("/@vite/client");
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

		// ---- 5. A page edit belongs to the dev server, not the backend ------
		const pageFile = join(scratch, "src", "main.tsx");
		const before = await readFile(pageFile, "utf8");
		const occurrences = before.split(ARGUMENT).length - 1;
		const edited = before.replaceAll(ARGUMENT, `{ name: "${MARKER}" }`);
		await writeFile(pageFile, edited, "utf8");

		// The dev server transforms on demand, so this is the module the window
		// re-requests — not the file on disk.
		const module = await poll(
			`${DEV_ORIGIN}/src/main.tsx`,
			(body) => body.includes(`"${MARKER}"`),
			STEP_TIMEOUT_MS,
		);
		const served = occurrences === 1 && module !== null;
		verdict.check(
			"edit served",
			served,
			occurrences !== 1
				? `src/main.tsx has ${occurrences} copies of ${ARGUMENT} — the edit was not the one this proof expects`
				: module !== null
					? `${DEV_ORIGIN}/src/main.tsx serves ${MARKER} after the save`
					: `${DEV_ORIGIN}/src/main.tsx never served ${MARKER} within ${STEP_TIMEOUT_MS / 1000} s` +
						(dev.alive()
							? ""
							: ` — crust dev had already exited: ${lastLine(dev.text("out")) || "no output"}`),
		);

		if (answered === null) {
			skip(
				verdict,
				["edit reload"],
				"not checked — the window never answered, so nothing reloads",
			);
		} else {
			// The window re-ran the module it was served: the new argument reached
			// the backend through the same cross-origin invoke.
			const reran = await dev.wait(
				"out",
				new RegExp(`greet\\s+hello ${MARKER} `),
				1,
				STEP_TIMEOUT_MS,
			);
			verdict.check(
				"edit reload",
				reran !== null,
				reran ??
					`no greet answer for ${MARKER} within ${STEP_TIMEOUT_MS / 1000} s — ` +
						(lastLine(dev.text("out")) || "nothing new on stdout"),
			);
		}

		// One runtime start is one bridge line. A second means the watcher restarted
		// the backend for a page edit, which rotates the token the loaded page holds.
		// Judged after a bounded settle: the watcher debounces a change by 150 ms and
		// a restarted runtime needs a moment to print its own bridge line, so reading
		// the log the instant the page reloads would report "no restart" for a
		// restart that is merely still in flight. That is a false pass this script
		// had until the settle went in.
		const settleUntil = performance.now() + RESTART_SETTLE_MS;
		while (performance.now() < settleUntil && !RESTARTED.test(dev.text("out"))) await delay(50);
		const restarted = RESTARTED.test(dev.text("out"));
		// A restarted runtime prints its own bridge line a moment later; wait for it,
		// bounded, so the count in the failure detail describes the whole sequence
		// instead of a restart caught halfway.
		if (restarted) {
			const bridgesUntil = performance.now() + RESTART_SETTLE_MS;
			while (performance.now() < bridgesUntil && count(dev.text("out"), BRIDGE) < 2) {
				await delay(50);
			}
		}
		const bridges = count(dev.text("out"), BRIDGE);
		const quiet = bridges === 1 && !restarted;
		// Gated on `served`: an edit that never reached the dev server would make a
		// single bridge line true by accident.
		if (!served) {
			skip(verdict, ["no restart"], "not checked — the edit never reached the dev server");
		} else {
			verdict.check(
				"no restart",
				quiet,
				quiet
					? "one bridge line across the edit — the backend was never restarted"
					: restarted
						? `the backend restarted for a page edit ("restart backend changed", ` +
							`${bridges} bridge line${bridges === 1 ? "" : "s"}) — the loaded page ` +
							"lost its token and the window was built again"
						: `${bridges} bridge lines across the edit — the runtime started more than once`,
			);
		}

		// ---- 5. What `crust dev` owns, and that all of it stops -----------
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
				proc.command.includes(
					join(scratch, "node_modules", "crust", "src", "runtime.ts"),
				) || proc.command.includes(join(REPO_ROOT, "src", "runtime.ts")),
		);
		// The template runs the dev server under Bun. If it went through the `.bin`
		// shebang instead, `node` would hold it — which is the bug this guards against.
		const viteUnderBun =
			vite !== undefined && !/\bnode\b/.test(vite.command.split(" ")[0] ?? "");
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
		const byPid = await survivors([dev.pid, ...owned]);
		const byPath = byPid.length === 0 ? await survivorsOf(scratch) : [];
		const left = [...new Set([...byPid, ...byPath])];
		verdict.check(
			"no survivors",
			left.length === 0,
			left.length === 0
				? `no process remains: ${owned.length} children signalled, nothing names the scratch path`
				: `still running: pid ${left.join(", ")}`,
		);
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
