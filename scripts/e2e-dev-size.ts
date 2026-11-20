/**
 * E2E for a window's size across a `crust dev` restart, and across stopping the runner. The memory
 * is scoped to one `crust dev` process: a backend edit restarts the child and the window comes back
 * at the size left it; a fresh `crust dev` opens at the configured size. The page drives the public
 * `window.getSize`/`window.setSize`, so the runtime's own log is the evidence.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, guardFocus, restoreFocus, survivorsOf, Verdict } from "./e2e-harness.ts";
import { type LiveRun, spawnLive } from "./lib/live-run.ts";
import { delay, lastLine } from "./lib/text.ts";

const NAME = "e2e-dev-size";
const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src/cli/index.ts");
/** The config's window size (content) and the frame `setSize` puts on that window. */
const CONFIG_SIZE = { width: 900, height: 640 };
const RESIZED = { width: 1024, height: 700 };
/** A cold start compiles the shim and starts WebKit; measured seconds, never minutes. */
const OPEN_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 15_000;
/** The save is debounced on frame change; the restart must not beat it. */
const SAVE_SETTLE_MS = 1_500;
const GRACE_MS = 8_000;

interface Size {
	width: number;
	height: number;
}
interface Phase {
	resize: boolean;
	tag: string;
}
const PAGE = `<!doctype html><html><head><meta charset="utf-8" /><title>crust e2e size</title></head><body><p id="status">window size probe</p><script src="/app.js"></script></body></html>`;

/** The page half: read the window, optionally resize it, and log every answer through `report`. */
function pageScript(): string {
	return `(() => {
	const invoke = window.crust.invoke.bind(window.crust);
	const size = () => invoke("window", "getSize", { label: "main" });
	const report = (tag, value) => invoke("report", { tag: tag, width: value.width, height: value.height });
	invoke("phase").then(async (phase) => {
		await report(phase.tag + "-open", await size());
		if (phase.resize) {
			await invoke("window", "setSize", { label: "main", width: ${RESIZED.width}, height: ${RESIZED.height} });
			await report(phase.tag + "-resized", await size());
		}
		await invoke("done", { tag: phase.tag });
	}).catch((error) => invoke("failed", { message: String(error && error.message ? error.message : error) }));
})();
`;
}

/** The backend half: expose the phase and turn the page's readings into runtime log lines. */
const BACKEND = `import { app } from "crust";
import { phase } from "./phase.ts";
app.command("phase", () => phase);
app.command("report", (args) => {
	console.log("  probe     " + String(args.tag) + " " + Number(args.width) + "x" + Number(args.height));
	return "ok";
});
app.command("done", (args) => {
	console.log("  probe     " + String(args.tag) + " done");
	return "ok";
});
app.command("failed", (args) => {
	console.log("  probe     failed " + String(args.message));
	return "ok";
});
await app.run();
`;

/** The backend module a restart re-imports; writing it is the backend change. */
function phaseSource(phase: Phase): string {
	return `export const phase = { resize: ${phase.resize}, tag: ${JSON.stringify(phase.tag)} } as const;\n`;
}

function configSource(appId: string): string {
	return `import type { CrustConfig } from "crust";
export default {
	app: { id: ${JSON.stringify(appId)}, name: "Crust e2e size", version: "0.0.0" },
	windows: [{ label: "main", url: "/", width: ${CONFIG_SIZE.width}, height: ${CONFIG_SIZE.height}, title: "crust e2e size" }],
} satisfies CrustConfig;
`;
}

async function scaffold(dir: string, appId: string): Promise<void> {
	await mkdir(join(dir, "public"), { recursive: true });
	await mkdir(join(dir, "node_modules"), { recursive: true });
	// The project imports `crust` by name; this checkout is the dependency.
	await symlink(REPO_ROOT, join(dir, "node_modules", "crust"), "dir");
	await writeFile(join(dir, "crust.config.ts"), configSource(appId));
	await writeFile(join(dir, "main.ts"), BACKEND);
	await writeFile(join(dir, "phase.ts"), phaseSource({ resize: true, tag: "first" }));
	await writeFile(join(dir, "public", "index.html"), PAGE);
	await writeFile(join(dir, "public", "app.js"), pageScript());
}

const show = (size: Size | null): string =>
	size === null ? "no reading" : `${size.width}x${size.height}`;
const same = (size: Size | null, want: Size): boolean =>
	size !== null && size.width === want.width && size.height === want.height;
/** The reading, or why the page never printed one. */
const why = (run: LiveRun, size: Size | null): string =>
	size === null ? `no reading — ${lastLine(run.text("out"))}` : show(size);

/** The whole size line for `tag`, or null when the page never printed one. */
async function waitSize(run: LiveRun, tag: string, timeoutMs: number): Promise<Size | null> {
	const re = new RegExp(`probe\\s+${tag}\\s+(\\d+)x(\\d+)`);
	const line = await run.wait("out", re, 1, timeoutMs);
	if (line === null) return null;
	const found = /(\d+)x(\d+)/.exec(line);
	return found === null ? null : { width: Number(found[1]), height: Number(found[2]) };
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(`${NAME}: SKIP  needs macOS; ${process.platform}/${process.arch}`);
		return 1;
	}

	const verdict = new Verdict();
	const appId = `land.jyz.e2e-dev-size-${Math.random().toString(36).slice(2, 8)}`;
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-dev-size-"));
	// A disk-persisting implementation would land here; removing it stops a red run seeding the next.
	const stateRoot = join(homedir(), "Library", "Application Support", appId);
	let dev: LiveRun | undefined;
	try {
		await scaffold(scratch, appId);
		await clearSurvivors(scratch);

		// ---- 1. the configured window, then the page resizes it ---------------
		const first = spawnLive([CLI, "dev", "--dir", scratch], REPO_ROOT, { graceMs: GRACE_MS });
		dev = first;
		const opened = await waitSize(first, "first-open", OPEN_TIMEOUT_MS);
		verdict.check("open at config", opened !== null, why(first, opened));
		if (opened === null) return verdict.report(NAME);

		const resized = await waitSize(first, "first-resized", STEP_TIMEOUT_MS);
		verdict.check("setSize applied", same(resized, RESIZED), why(first, resized));
		if (resized === null) return verdict.report(NAME);
		await first.wait("out", /probe\s+first done/, 1, STEP_TIMEOUT_MS);
		// Let the debounced write land before the child that owns it is killed.
		await delay(SAVE_SETTLE_MS);

		// ---- 2. a backend change restarts the child; the size comes back ------
		await writeFile(join(scratch, "phase.ts"), phaseSource({ resize: false, tag: "restart" }));
		const remembered = await waitSize(first, "restart-open", OPEN_TIMEOUT_MS);
		verdict.check("restart remembered", same(remembered, RESIZED), why(first, remembered));
		verdict.check(
			"restart not config",
			remembered !== null && !same(remembered, opened),
			`opened ${show(opened)}, came back ${show(remembered)}`,
		);

		await first.stop();
		dev = undefined;
		await clearSurvivors(scratch);

		// ---- 3. a new `crust dev` is a new memory: the config size returns ----
		await writeFile(join(scratch, "phase.ts"), phaseSource({ resize: false, tag: "cold" }));
		const second = spawnLive([CLI, "dev", "--dir", scratch], REPO_ROOT, { graceMs: GRACE_MS });
		dev = second;
		const cold = await waitSize(second, "cold-open", OPEN_TIMEOUT_MS);
		verdict.check("fresh dev at config", same(cold, opened), why(second, cold));
		verdict.check(
			"fresh dev not remembered",
			cold !== null && !same(cold, RESIZED),
			`${show(cold)}, not ${RESIZED.width}x${RESIZED.height}`,
		);

		await second.stop();
		dev = undefined;
		const survivors = await survivorsOf(scratch);
		verdict.check("no survivors", survivors.length === 0, `${survivors.length} pid(s)`);
	} finally {
		await dev?.stop().catch(() => undefined);
		await clearSurvivors(scratch).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		await rm(stateRoot, { recursive: true, force: true }).catch(() => undefined);
	}
	return verdict.report(NAME);
}

// Armed before the first window opens. Its decision is what the `finally` restores; a Ctrl-C runs no
// `finally`, so the guard also restores on `exit` and the three signals.
const frontmost = guardFocus();
let code: number;
try {
	code = await main();
} catch (error) {
	console.log(`${NAME}: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	code = 1;
} finally {
	// Before the exit, because `process.exit` does not run a `finally`.
	await restoreFocus(frontmost);
}
process.exit(code);
