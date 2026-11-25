/**
 * AppKit-only floor probe for the 318 ms create segment. One arm per process.
 *   probe-run -c 'timeout 20 bun scripts/perf/startup-bare.ts measure --arm bare-inline --label bare-inline-1'
 *   bun scripts/perf/startup-bare.ts summary --arm bare-inline
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cac } from "cac";
import { startBridge } from "../../src/bridge/server.ts";
import { definePlugin } from "../../src/plugins/define.ts";
import {
	CONTENT_WORLD_SOURCE,
	PAGE_BRIDGE_SOURCE,
} from "../../src/platform/darwin/content-world-source.ts";
import { ARMS, PAGE } from "./startup-bare-arms.ts";
import { runConditions, snapshot } from "./conditions.ts";
import { bareNative } from "./startup-bare-native.ts";

const processStart =
	Date.now() - (typeof process.uptime === "function" ? process.uptime() * 1000 : 0);
const marks: Record<string, number> = { processStart: 0 };
const mark = (name: string): void => {
	marks[name] = Date.now() - processStart;
};
mark("firstLine");

const root = resolve(import.meta.dir, "../..");
const samples = resolve(root, "docs/reviews/perf/startup");
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const cstr = (text: string): Uint8Array => new TextEncoder().encode(`${text}\0`);

export async function measure(armName: string, label: string): Promise<number> {
	const arm = ARMS[armName];
	if (process.platform !== "darwin" || arm === undefined) {
		console.log(`startup-bare: FAIL unknown arm ${armName}`);
		return 1;
	}
	if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(label)) {
		console.log(`startup-bare: FAIL bad label ${label}`);
		return 1;
	}
	const start = await snapshot();
	mark("conditionsDone");
	let bridge: Awaited<ReturnType<typeof startBridge>> | undefined;
	const publicDir = mkdtempSync(join(tmpdir(), "crust-bare-page-"));
	writeFileSync(join(publicDir, "index.html"), PAGE, "utf8");
	const openBridge = (): void => {
		bridge = startBridge({
			handlers: [definePlugin({ name: "bare", commands: { ping: () => true } })],
			root: publicDir,
			port: 0,
		});
	};
	if (arm.bridge) {
		openBridge();
		mark("bridgeDone");
	} else {
		mark("bridgeDone");
	}
	const native = bareNative();
	mark("nativeReady");
	let done = false;
	const cleanup = (): void => {
		try {
			native.bare_destroy();
		} catch {
			// Already torn down; exit handlers cannot report.
		}
	};
	process.on("exit", cleanup);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			cleanup();
			process.kill(process.pid, signal);
		});
	}
	try {
		const web = native.bare_create(
			240,
			160,
			arm.flags,
			cstr(CONTENT_WORLD_SOURCE),
			cstr(PAGE_BRIDGE_SOURCE),
		);
		if (!web) throw new Error("bare_create returned null");
		mark("windowCreated");
		if (arm.deferBeforeLoad && bridge === undefined) {
			openBridge();
			mark("bridgeDone");
		}
		if (arm.load === "html") {
			if (armName === "bare-sync") native.bare_load_sync();
			else native.bare_load_html(cstr(PAGE));
		} else {
			// A document route needs a token; the negative arm points at a closed port.
			const url =
				bridge === undefined
					? "http://127.0.0.1:1/?token=none"
					: `${bridge.url}/?token=${bridge.token}`;
			native.bare_load_url(cstr(url));
		}
		mark("loadIssued");
		const deadline =
			performance.now() + (arm.load === "url" && bridge === undefined ? 4_000 : 10_000);
		while (!done && performance.now() < deadline) {
			native.bare_pump();
			done = native.bare_done() === 1;
			if (!done) await sleep(5);
		}
		mark(done ? "firstRaf" : "timedOut");
		if (arm.after && done) {
			openBridge();
			mark("bridgeAfterPaint");
		}
	} finally {
		cleanup();
		process.removeListener("exit", cleanup);
		await bridge?.stop();
		await rm(publicDir, { recursive: true, force: true });
	}
	const end = await snapshot();
	const record = {
		label,
		arm: armName,
		mode: armName,
		marks,
		segments: {
			prelude: marks.firstLine ?? 0,
			conditions: (marks.conditionsDone ?? 0) - (marks.firstLine ?? 0),
			bridge: (marks.bridgeDone ?? 0) - (marks.conditionsDone ?? 0),
			cc: (marks.nativeReady ?? 0) - (marks.bridgeDone ?? 0),
			window: (marks.windowCreated ?? 0) - (marks.nativeReady ?? 0),
			loadIssue: (marks.loadIssued ?? 0) - (marks.windowCreated ?? 0),
			firstRaf: (marks.firstRaf ?? marks.timedOut ?? 0) - (marks.loadIssued ?? 0),
		},
		totalMs: marks.firstRaf ?? marks.timedOut ?? 0,
		painted: done,
		scriptBytes: CONTENT_WORLD_SOURCE.length + PAGE_BRIDGE_SOURCE.length,
		conditions: runConditions(start, end),
	};
	mkdirSync(samples, { recursive: true });
	await writeFile(join(samples, `${label}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
	console.log(
		`startup-bare ${label}/${armName}: ${record.totalMs} ms painted=${done} ` +
			`contaminated=${record.conditions.contaminated} load ${record.conditions.start.load.one.toFixed(2)}`,
	);
	return done ? 0 : 1;
}

const cli = cac("startup-bare");
cli.command("measure", "run one arm")
	.option("--arm <name>", Object.keys(ARMS).join(" | "), { default: "bare-inline" })
	.option("--label <name>", "sample label", { default: "bare-inline" });
cli.command("summary", "p50/p95 for one arm").option("--arm <name>", "arm name", {
	default: "bare-inline",
});
const parsed = cli.parse(["bun", "startup-bare", ...process.argv.slice(2)], { run: false });
mark("cliParsed");
if (process.argv[2] === "measure") {
	process.exitCode = await measure(
		String(parsed.options.arm ?? "bare-inline"),
		String(parsed.options.label ?? "bare-inline"),
	);
} else if (process.argv[2] === "summary") {
	const arm = String(parsed.options.arm ?? "bare-inline");
	const names = (await readdir(samples).catch(() => []))
		.filter((name) => name.startsWith(`${arm}-`) && name.endsWith(".json"))
		.sort();
	const records = await Promise.all(
		names.map(async (name) => JSON.parse(await readFile(join(samples, name), "utf8"))),
	);
	const totals = records.map((record) => record.totalMs as number).sort((a, b) => a - b);
	if (totals.length === 0) {
		console.log("startup-bare: no samples");
		process.exitCode = 1;
	} else {
		const p = (q: number): number =>
			totals[Math.min(totals.length - 1, Math.ceil(q * totals.length) - 1)] ?? 0;
		console.log(
			`${arm}: n=${totals.length} p50=${p(0.5)} p95=${p(0.95)} max=${totals.at(-1)} min=${totals[0]}`,
		);
	}
} else {
	cli.outputHelp();
	process.exitCode = 1;
}
