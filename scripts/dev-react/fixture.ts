/**
 * The React dev shape's fixture and its small I/O helpers: the pinned port, the
 * lines the runtime prints, and the HTTP/env plumbing the phases read through.
 */
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCommand } from "../e2e-harness.ts";
import { delay, lastLine } from "../lib/text.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
// CRUST_BIN lets the same suite judge a *shipped* crust — an installed tarball or a
// compiled binary — rather than this checkout. Default is the checkout.
export const CLI = process.env.CRUST_BIN ?? join(REPO_ROOT, "src/cli/index.ts");

/**
 * The port and origin the scaffold pins. `vite.config.ts` sets `strictPort: true`
 * on purpose — the bridge allowlists exactly the origin `dev.url` names, so a
 * Vite that quietly moved to the next free port would produce a page whose every
 * invoke is a CORS refusal. A test that accepted "some port" would pass while
 * that happened.
 */
export const DEV_PORT = 5173;
export const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;

/** The page's answer for the value the scaffold ships (`{ name: "react" }`). */
export const GREET = /greet\s+hello react \(page call answered\)/;
/** The runtime was restarted instead of the page being reloaded — phase 4 forbids it. */
export const RESTARTED = /restart\s+backend changed/;
/** The runtime printing the address it serves, and the origin it expects the page from. */
export const BRIDGE = /bridge\s+http:\/\/127\.0\.0\.1:\d+\s+\(page from http:\/\/localhost:5173\)/;

/** Vite's cold start, the shim compile and WebKit's web process. Measured ~2 s. */
export const START_TIMEOUT_MS = 45_000;
/** One save, Vite's HMR reload and the page's answer. Measured < 1 s. */
export const STEP_TIMEOUT_MS = 20_000;
/** The runtime's bridge pair, published after the frontend was spawned. Measured < 2 s. */
export const PAIR_TIMEOUT_MS = 30_000;
/**
 * How long a restart can take to show itself. `crust dev` debounces a backend
 * change by 150 ms, then kills the runtime and spawns another that prints its own
 * bridge line, so "no restart" cannot be judged at the instant the page reloads.
 */
export const RESTART_SETTLE_MS = 2500;
/** How long a signalled process gets before SIGKILL. */
export const GRACE_MS = 8000;

/** The text the edit puts in the page; it must reach the served module. */
export const MARKER = "edited";
/** Exactly what the scaffold's `src/main.tsx` passes to `invoke`. */
export const ARGUMENT = '{ name: "react" }';

/**
 * Why the page never answered, in one line.
 *
 * Two facts decide it and both are in the runtime's own output: whether a window
 * was created at all, and whether it was created before the dev server printed
 * its ready banner. The second is the failure this shape has — `loadRequest:` is
 * issued once, so a window that navigates before the frontend is listening has
 * nothing to connect to, and the page never runs.
 */
export function windowEvidence(out: string, running: boolean): string {
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

/** PIDs listening on `port`, via lsof. Exit 1 means none, which is what we want. */
export async function listeners(port: number): Promise<number[]> {
	const { stdout } = await runCommand(
		["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
		REPO_ROOT,
	);
	return stdout
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** The bridge pair the runtime published for the dev server to read per request. */
export interface Handshake {
	url: string;
	token: string;
}

async function handshake(path: string): Promise<Handshake | null> {
	const text = await Bun.file(path)
		.text()
		.catch(() => "");
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
export async function pollHandshake(path: string, timeoutMs: number): Promise<Handshake | null> {
	const deadline = performance.now() + timeoutMs;
	for (;;) {
		const pair = await handshake(path);
		if (pair !== null) return pair;
		if (performance.now() >= deadline) return null;
		await delay(150);
	}
}

/** One GET, as text plus status; a refused connection is not an exception here. */
export async function get(url: string): Promise<{ status: number; body: string } | null> {
	try {
		const response = await fetch(url);
		return { status: response.status, body: await response.text() };
	} catch {
		return null;
	}
}

/** Poll `url` until its body satisfies `done`, or the deadline passes. */
export async function poll(
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

export async function exists(path: string): Promise<boolean> {
	return stat(path)
		.then((entry) => entry.isFile())
		.catch(() => false);
}
